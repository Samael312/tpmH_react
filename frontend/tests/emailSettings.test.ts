import { describe, it, expect } from 'vitest'
import { quotaPercent, usageLabel, alertMessage, buildUpdate, type EmailSettings } from '@/lib/emailSettings'

const saved: EmailSettings = {
  categories: [
    { key: 'welcome', label: 'Bienvenida', probability: 'media', essential: false, enabled: true, sent_today: 0, skipped_today: 0, failed_today: 0, emails: [] },
    { key: 'class_reminders', label: 'Recordatorios', probability: 'muy_alta', essential: false, enabled: true, sent_today: 0, skipped_today: 0, failed_today: 0, emails: [] },
    { key: 'essential', label: 'Esenciales', probability: 'baja', essential: true, enabled: true, sent_today: 0, skipped_today: 0, failed_today: 0, emails: [] },
  ],
  sent_today: 37, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80, auto_saver_active: false,
  skipped_today: 0, failed_today: 0, alert: false,
}

describe('quotaPercent / usageLabel', () => {
  it('calcula el porcentaje y lo acota a 0–100', () => {
    expect(quotaPercent(37, 100)).toBe(37)
    expect(quotaPercent(0, 100)).toBe(0)
    expect(quotaPercent(100, 100)).toBe(100)
    expect(quotaPercent(101, 100)).toBe(100)
    expect(quotaPercent(-5, 100)).toBe(0)
  })
  it('un límite 0 o inválido no divide por cero', () => {
    expect(quotaPercent(5, 0)).toBe(0)
    expect(quotaPercent(5, -1)).toBe(0)
  })
  it('formatea «37 / 100»', () => expect(usageLabel(37, 100)).toBe('37 / 100'))
})

describe('alertMessage', () => {
  it('sin alerta no hay mensaje', () => {
    expect(alertMessage(null)).toBeNull()
    expect(alertMessage({ skipped_today: 0, failed_today: 0, alert: false })).toBeNull()
  })
  it('singular y plural', () => {
    expect(alertMessage({ skipped_today: 1, failed_today: 0, alert: true })).toContain('1 correo omitido')
    expect(alertMessage({ skipped_today: 3, failed_today: 2, alert: true })).toContain('3 correos omitidos y 2 fallidos')
  })
})

describe('buildUpdate', () => {
  const same = { enabled: { welcome: true, class_reminders: true, essential: true }, daily_limit: 100, auto_saver_enabled: false, auto_saver_percent: 80 }
  it('sin cambios devuelve un cuerpo vacío', () => expect(buildUpdate(saved, same)).toEqual({}))
  it('solo envía lo que cambió', () => {
    expect(buildUpdate(saved, { ...same, enabled: { ...same.enabled, welcome: false }, daily_limit: 3000 }))
      .toEqual({ notifications: { welcome: false }, daily_limit: 3000 })
  })
  it('nunca envía las categorías esenciales', () => {
    expect(buildUpdate(saved, { ...same, enabled: { ...same.enabled, essential: false } })).toEqual({})
  })
  it('modo ahorro y porcentaje', () => {
    expect(buildUpdate(saved, { ...same, auto_saver_enabled: true, auto_saver_percent: 90 }))
      .toEqual({ auto_saver_enabled: true, auto_saver_percent: 90 })
  })
})
