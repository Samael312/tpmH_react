---
roles: [student]
keywords: [registro, registrarme, contraseña, olvide, verificar, verificacion, correo, email, no me llega, google, usuario, iniciar sesion, entrar]
summary: Registrarse, entrar, recuperar contraseña o usuario y verificar el email.
---
## Regla
Te registras en /register con nombre, apellido, usuario (3-30 caracteres, minúsculas), email y contraseña de 8 a 128 caracteres, o con Google. Si olvidaste la contraseña o el usuario, usa /forgot-password: recibes un correo con un enlace de un solo uso que caduca.
Puedes entrar sin verificar el email, pero sin verificar no puedes enviar pagos ni vincular Google. Para verificar, abre el enlace del correo que te llega al registrarte.

## Casos límite
- No llega el correo: revisa spam y espera unos minutos; si sigue sin llegar, pide un correo nuevo desde el aviso "verifica tu email" que aparece en tu panel.
- Tras 8 contraseñas erróneas seguidas, el acceso de esa cuenta se bloquea 15 minutos aunque luego la pongas bien.
- Cuenta creada solo con Google: entra con el botón de Google (con usuario y contraseña da error).
- Si cambias tu email, la cuenta queda sin verificar y se envía un enlace al correo nuevo.

## Cuándo escalar
Si tras esperar y revisar spam no recibes el correo, o la cuenta sigue bloqueada, que abra un ticket en Soporte.
