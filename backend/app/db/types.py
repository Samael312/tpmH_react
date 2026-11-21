"""Tipos de columna compartidos."""
from sqlalchemy import Numeric

# Dinero: NUMERIC(12,2) en la BD (sin errores de coma flotante al sumar/restar centavos) pero
# `asdecimal=False`: en Python sigue siendo float, asi el JSON de la API sigue siendo un numero
# y el calculo de comisiones (round(x * rate, 2)) no mezcla Decimal con float.
Money = Numeric(12, 2, asdecimal=False)
