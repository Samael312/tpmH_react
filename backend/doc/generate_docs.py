"""
Regenera las partes AUTOMÁTICAS de la documentación (backend/doc y frontend/doc).

    cd backend
    python doc/generate_docs.py

No necesita .env ni PostgreSQL (usa SQLite temporal solo para importar la app).
Genera:
  backend/doc/generated/API_REFERENCE.md   rutas, auth, rate-limit, docstring, archivo:línea
  backend/doc/generated/MODELS.md          tablas y columnas (desde SQLAlchemy)
  backend/doc/generated/CORE_FUNCTIONS.md  funciones públicas de app/core y app/auth
  backend/doc/generated/SCHEMAS.md         modelos Pydantic y validadores
  frontend/doc/generated/ROUTES.md         páginas Next.js, layout, guard por rol
  frontend/doc/generated/COMPONENTS.md     componentes, hooks, stores y lib (exports + 1ª línea)
  frontend/doc/generated/API_CALLS.md      llamadas a la API por archivo, marcando las que no casan con rutas
Los .md de nivel superior (README, BUSINESS_RULES, ...) se escriben a mano.
"""
import ast
import glob
import inspect
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
FRONT = os.path.join(ROOT, "frontend")
sys.path.insert(0, BACKEND)

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.gettempdir()}/tpm_docgen.db")
for k, v in (("SECRET_KEY", "x"), ("OPENAI_API_KEY", "sk-dummy"), ("GEMINI_API_KEY", "x"), ("ENVIRONMENT", "development")):
    os.environ.setdefault(k, v)

from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(JSONB, "sqlite")
def _j(t, c, **kw):
    return "JSON"


def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8", newline="\n") as f:
        f.write(text)
    print("escrito", os.path.relpath(path, ROOT))


def first_line(doc):
    if not doc:
        return ""
    doc = inspect.cleandoc(doc).strip()
    return doc.split("\n\n")[0].replace("\n", " ")[:300]


# ─────────────────────────── BACKEND ────────────────────────────
def gen_api():
    from app.main import app
    out = ["# API_REFERENCE (generado)\n", "Generado por `backend/doc/generate_docs.py`. Prefijo global: `/api/v1`.",
           "Auth = dependencia FastAPI de rol detectada. `—` = sin autenticación (pública).\n"]
    rows = {}
    for r in app.routes:
        p = getattr(r, "path", "")
        if not p.startswith("/api/v1") or not hasattr(r, "endpoint"):
            continue
        fn = inspect.unwrap(r.endpoint)
        try:
            src_lines, line = inspect.getsourcelines(fn)
            src = "".join(src_lines[:12])
            file = os.path.relpath(inspect.getsourcefile(fn), BACKEND).replace("\\", "/")
        except Exception:
            src, line, file = "", 0, "?"
        auth = []
        dep = getattr(r, "dependant", None)
        stack = list(dep.dependencies) if dep else []
        while stack:
            d = stack.pop()
            n = getattr(d.call, "__name__", "")
            if n.startswith("get_current"):
                auth.append(n)
            stack.extend(d.dependencies)
        lim = re.findall(r'@limiter\.limit\("([^"]+)"', src)
        methods = ",".join(sorted(m for m in (getattr(r, "methods", None) or ["WS"]) if m not in ("HEAD", "OPTIONS")))
        tag = (getattr(r, "tags", None) or ["-"])[0]
        rows.setdefault(tag, []).append((p[len("/api/v1"):], methods, ", ".join(sorted(set(auth))) or "—",
                                         lim[0] if lim else "", f"{file}:{line}", fn.__name__, first_line(fn.__doc__)))
    total = sum(len(v) for v in rows.values())
    out.append(f"Total de rutas: **{total}**\n")
    for tag, items in rows.items():
        out.append(f"\n## {tag}\n")
        out.append("| Método | Ruta | Auth | Límite | Función (archivo:línea) | Qué hace |")
        out.append("|---|---|---|---|---|---|")
        for path, m, a, lim, loc, name, doc in sorted(items):
            out.append(f"| {m} | `{path}` | {a} | {lim} | `{name}` ({loc}) | {doc.replace('|', '/')} |")
    w(os.path.join(HERE, "generated", "API_REFERENCE.md"), "\n".join(out) + "\n")


def gen_models():
    import app.models  # noqa: F401
    from app.db.base import Base
    out = ["# MODELS (generado)\n", "Tablas SQLAlchemy y columnas. FK = clave foránea; `?` = nullable.\n"]
    for t in sorted(Base.metadata.tables.values(), key=lambda x: x.name):
        out.append(f"\n## {t.name}\n")
        out.append("| Columna | Tipo | Notas |")
        out.append("|---|---|---|")
        for c in t.columns:
            notes = []
            if c.primary_key:
                notes.append("PK")
            if c.unique:
                notes.append("unique")
            if c.foreign_keys:
                notes.append("FK→" + ",".join(sorted({f.target_fullname for f in c.foreign_keys})))
            if c.nullable and not c.primary_key:
                notes.append("?")
            if c.default is not None and getattr(c.default, "arg", None) is not None and not callable(c.default.arg):
                notes.append(f"default={c.default.arg}")
            out.append(f"| {c.name} | {str(c.type)[:40]} | {' '.join(notes)} |")
    w(os.path.join(HERE, "generated", "MODELS.md"), "\n".join(out) + "\n")


def _py_funcs(path):
    src = open(path, encoding="utf8").read()
    tree = ast.parse(src)
    res = []
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = ast.unparse(n.args)[:140]
            res.append((("async " if isinstance(n, ast.AsyncFunctionDef) else "") + n.name, args, n.lineno,
                        first_line(ast.get_docstring(n))))
        elif isinstance(n, ast.ClassDef):
            res.append(("class " + n.name, "", n.lineno, first_line(ast.get_docstring(n))))
    return res


def gen_core():
    out = ["# CORE_FUNCTIONS (generado)\n", "Funciones y clases de nivel módulo en `app/core`, `app/auth` y `app/db`.",
           "Las que empiezan por `_` son privadas del módulo.\n"]
    for d in ("core", "core/chipi", "auth", "db"):
        for f in sorted(glob.glob(os.path.join(BACKEND, "app", d, "*.py"))):
            if f.endswith("__init__.py"):
                continue
            funcs = _py_funcs(f)
            if not funcs:
                continue
            out.append(f"\n## app/{d}/{os.path.basename(f)}\n")
            for name, args, line, doc in funcs:
                out.append(f"- `{name}({args})` — L{line}" + (f": {doc}" if doc else ""))
    w(os.path.join(HERE, "generated", "CORE_FUNCTIONS.md"), "\n".join(out) + "\n")


def gen_schemas():
    out = ["# SCHEMAS (generado)\n", "Modelos Pydantic (`app/schemas`) con campos y validadores.\n"]
    for f in sorted(glob.glob(os.path.join(BACKEND, "app", "schemas", "*.py"))):
        if f.endswith("__init__.py"):
            continue
        tree = ast.parse(open(f, encoding="utf8").read())
        classes = [n for n in tree.body if isinstance(n, ast.ClassDef)]
        if not classes:
            continue
        out.append(f"\n## schemas/{os.path.basename(f)}\n")
        for c in classes:
            fields, vals = [], []
            for n in c.body:
                if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):
                    fields.append(f"{n.target.id}: {ast.unparse(n.annotation)}" + (f" = {ast.unparse(n.value)[:40]}" if n.value else ""))
                if isinstance(n, ast.FunctionDef) and any("validator" in ast.unparse(d) for d in n.decorator_list):
                    vals.append(n.name)
            out.append(f"- **{c.name}** — " + "; ".join(fields)[:600] + (f"  _(validadores: {', '.join(vals)})_" if vals else ""))
    w(os.path.join(HERE, "generated", "SCHEMAS.md"), "\n".join(out) + "\n")


# ─────────────────────────── FRONTEND ───────────────────────────
def _comment_head(src):
    m = re.match(r"\s*(?:\"use client\";?\s*)?(/\*\*?(.*?)\*/|((?://[^\n]*\n)+))", src, re.S)
    if m:
        t = (m.group(2) or m.group(3) or "")
        t = re.sub(r"^\s*(\*|//)\s?", "", t, flags=re.M).strip().replace("\n", " ")
        return t[:240]
    return ""


def gen_front_routes():
    app_dir = os.path.join(FRONT, "app")
    guard = {"dashboard": "student", "teacher": "teacher, teacher_admin", "admin": "superadmin, teacher_admin"}
    out = ["# ROUTES (generado)\n", "Páginas del App Router. Guard = `proxy.ts` (solo UX: decodifica el JWT SIN verificar firma; la seguridad real es el backend).\n",
           "| URL | Archivo | Guard (rol) | Líneas | Nota |", "|---|---|---|---|---|"]
    for f in sorted(glob.glob(os.path.join(app_dir, "**", "page.tsx"), recursive=True)):
        rel = os.path.relpath(f, app_dir).replace("\\", "/")
        url = "/" + re.sub(r"\(.*?\)/", "", rel).replace("/page.tsx", "").replace("page.tsx", "")
        url = url.rstrip("/") or "/"
        first = url.strip("/").split("/")[0]
        g = guard.get(first, "pública" if first not in ("",) else "pública")
        src = open(f, encoding="utf8").read()
        out.append(f"| `{url}` | `app/{rel}` | {g} | {src.count(chr(10)) + 1} | {_comment_head(src)[:120]} |")
    out.append("\n## Layouts\n")
    for f in sorted(glob.glob(os.path.join(app_dir, "**", "layout.tsx"), recursive=True)):
        rel = os.path.relpath(f, app_dir).replace("\\", "/")
        out.append(f"- `app/{rel}` — {_comment_head(open(f, encoding='utf8').read())[:200]}")
    w(os.path.join(FRONT, "doc", "generated", "ROUTES.md"), "\n".join(out) + "\n")


def gen_front_components():
    out = ["# COMPONENTS / HOOKS / STORES / LIB (generado)\n"]
    for d in ("components", "hooks", "store", "lib"):
        out.append(f"\n## {d}/\n")
        for f in sorted(glob.glob(os.path.join(FRONT, d, "**", "*.ts*"), recursive=True)):
            src = open(f, encoding="utf8").read()
            rel = os.path.relpath(f, FRONT).replace("\\", "/")
            exports = re.findall(r"export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)", src)
            used_by = sum(1 for g in glob.glob(os.path.join(FRONT, "**", "*.ts*"), recursive=True)
                          if "node_modules" not in g and ".next" not in g and g != f
                          and re.search(r"\b" + re.escape(os.path.splitext(os.path.basename(f))[0]) + r"\b", open(g, encoding="utf8", errors="ignore").read()))
            out.append(f"- `{rel}` ({src.count(chr(10)) + 1} líneas, referenciado en {used_by} archivos) — exports: {', '.join(exports[:12]) or '—'}"
                       + (f" — {_comment_head(src)[:160]}" if _comment_head(src) else ""))
    w(os.path.join(FRONT, "doc", "generated", "COMPONENTS.md"), "\n".join(out) + "\n")


def gen_front_api_calls():
    from app.main import app
    routes = set()
    for r in app.routes:
        p = getattr(r, "path", "")
        if p.startswith("/api/v1"):
            for m in getattr(r, "methods", None) or []:
                if m not in ("HEAD", "OPTIONS"):
                    routes.add((m, re.sub(r"\{[^}]*\}", "{x}", p[len("/api/v1"):]).rstrip("/") or "/"))
    pat = re.compile(r"\b(?:api|axios)\.(get|post|put|patch|delete)\(\s*([`'\"])(.+?)\2", re.S)
    per, bad = {}, []
    for d in ("app", "components", "hooks", "lib", "store"):
        for f in glob.glob(os.path.join(FRONT, d, "**", "*.ts*"), recursive=True):
            rel = os.path.relpath(f, FRONT).replace("\\", "/")
            src = open(f, encoding="utf8").read()
            for m in pat.finditer(src):
                url = re.sub(r"\$\{[^}]*\}", "{x}", m.group(3)).split("?")[0]
                key = (m.group(1).upper(), url.rstrip("/") or "/")
                per.setdefault(rel, set()).add(key)
                ok = key in routes or any(key[0] == r[0] and re.fullmatch(re.escape(r[1]).replace(r"\{x\}", r"[^/]+"), key[1]) for r in routes)
                if not ok:
                    bad.append((*key, rel))
    out = ["# API_CALLS (generado)\n", "Llamadas `api.<verbo>(...)` por archivo (regex; las URLs construidas dinámicamente fuera de la llamada no se detectan).\n"]
    out.append("## ⚠ Llamadas que NO casan con ninguna ruta del backend\n")
    out += [f"- {m} `{u}` en `{f}`" for m, u, f in sorted(set(bad))] or ["- (ninguna)"]
    out.append("\n## Por archivo\n")
    for rel in sorted(per):
        out.append(f"- `{rel}`: " + ", ".join(f"{m} {u}" for m, u in sorted(per[rel])))
    w(os.path.join(FRONT, "doc", "generated", "API_CALLS.md"), "\n".join(out) + "\n")


if __name__ == "__main__":
    gen_api(); gen_models(); gen_core(); gen_schemas()
    gen_front_routes(); gen_front_components(); gen_front_api_calls()
