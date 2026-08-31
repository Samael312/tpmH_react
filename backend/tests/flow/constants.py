"""
Credenciales y datos fijos de los 4 usuarios de prueba del flow-tester.

Estos usuarios se crean UNA sola vez (ver seed.py) y se reutilizan en todas
las corridas de la suite. Nunca se borran entre tests ni entre sesiones de
pytest — lo único volátil son los DATOS que generan (clases, materiales,
tareas, enrollments, etc.), que cada test limpia en su propio teardown.

Se pueden sobreescribir por variable de entorno si en algún entorno ya
existen cuentas con esos correos y se prefiere usar otras.
"""
import os

FLOW_TEST_PASSWORD = os.getenv("FLOW_TEST_PASSWORD", "FlowTest!2024")

SUPERADMIN = {
    "email": os.getenv("FLOW_TEST_SUPERADMIN_EMAIL", "flowtest.superadmin@tpmh.internal"),
    "username": "flowtest_superadmin",
    "name": "FlowTest",
    "surname": "Superadmin",
    "password": FLOW_TEST_PASSWORD,
    "role": "superadmin",
}

TEACHER_ADMIN = {
    "email": os.getenv("FLOW_TEST_TEACHER_ADMIN_EMAIL", "flowtest.teacheradmin@tpmh.internal"),
    "username": "flowtest_teacheradmin",
    "name": "FlowTest",
    "surname": "TeacherAdmin",
    "password": FLOW_TEST_PASSWORD,
    "role": "teacher_admin",
}

TEACHER = {
    "email": os.getenv("FLOW_TEST_TEACHER_EMAIL", "flowtest.teacher@tpmh.internal"),
    "username": "flowtest_teacher",
    "name": "FlowTest",
    "surname": "Teacher",
    "password": FLOW_TEST_PASSWORD,
    "role": "teacher",
    # Estado que necesita el perfil de profesor para que TODOS los
    # endpoints de "profesor aprobado" funcionen sin fricción:
    "teacher_profile": {
        "bio": "Cuenta fija de pruebas automatizadas — no es un profesor real.",
        "title": "Profesor de prueba",
        "timezone": "America/Bogota",
        "languages": ["English"],
        "subjects": ["English"],
        "status": "approved",
        "video_url": "https://example.com/flowtest-video.mp4",
        "theme_color": "#ec4899",
    },
}

STUDENT = {
    "email": os.getenv("FLOW_TEST_STUDENT_EMAIL", "flowtest.student@tpmh.internal"),
    "username": "flowtest_student",
    "name": "FlowTest",
    "surname": "Student",
    "password": FLOW_TEST_PASSWORD,
    "role": "student",
    "student_profile": {
        "timezone": "America/Bogota",
        "goal": "Cuenta fija de pruebas automatizadas.",
    },
}

ALL_FIXED_USERS = [SUPERADMIN, TEACHER_ADMIN, TEACHER, STUDENT]
