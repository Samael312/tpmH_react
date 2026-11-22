---
summary: Registro
---
## Qué es
PANTALLA: Registro
El usuario está creando su cuenta. También puede registrarse con Google.
- Modo multi-tenant: aparece el selector "Soy... Estudiante / Profesor" —
  puede postularse como profesor, y su cuenta queda "pendiente de
  aprobación" hasta que el staff revise su perfil.
- Modo single-tenant: ese selector NO aparece — todo el que se registra
  entra como estudiante (en este modo la plataforma tiene un único
  profesor ya configurado por el staff, no hay postulación pública).
El campo más confuso suele ser la zona horaria: si pregunta cuál elegir,
pregúntale desde qué ciudad se conecta y dile exactamente cuál buscar.
Ejemplo: Venezuela → America/Caracas, España peninsular → Europe/Madrid.

## Pasos
Elige Estudiante o Profesor, nombre, apellido, usuario y email → Siguiente → contraseña y confirmación, acepta Términos y Privacidad → Crear cuenta.

## Reglas
Usuario 3-30 caracteres en minúsculas; contraseña 8-128. El profesor nace pendiente de aprobación. Se envía un correo de verificación.

## Casos límite
Usuario o email ya usados dan error. Los roles de admin no se pueden elegir aquí.

## Cuándo escalar
Si sigue el problema, escribir a soporte@mail.tuprofemaria.com (o Soporte tras iniciar sesión).
