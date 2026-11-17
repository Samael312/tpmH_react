import { describe, it, expect } from 'vitest'
import {
  MAX_SPOKEN_LANGUAGES, languageKey, toggleLanguage, isSelected, canContinue, atLimit,
  formatSpoken, needsSpokenLanguages, sameLanguages,
} from '@/lib/spokenLanguages'

describe('languageKey', () => {
  it('ignora mayúsculas, tildes y espacios', () => {
    expect(languageKey(' INGLÉS ')).toBe('ingles')
    expect(languageKey('Español')).toBe(languageKey('espanol'))
  })
})

describe('toggleLanguage', () => {
  it('marca y desmarca', () => {
    expect(toggleLanguage([], 'Inglés')).toEqual(['Inglés'])
    expect(toggleLanguage(['Inglés'], 'Inglés')).toEqual([])
  })
  it('desmarca aunque cambie la capitalización o la tilde', () => {
    expect(toggleLanguage(['Inglés', 'Español'], 'ingles')).toEqual(['Español'])
  })
  it('no pasa del máximo (10 sí, 11 no)', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `L${i}`)
    const ten = toggleLanguage(nine, 'L9')
    expect(ten).toHaveLength(MAX_SPOKEN_LANGUAGES)
    expect(toggleLanguage(ten, 'L10')).toEqual(ten)
  })
  it('con el máximo lleno todavía se puede desmarcar', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `L${i}`)
    expect(toggleLanguage(ten, 'L3')).toHaveLength(9)
  })
  it('no muta la lista original', () => {
    const base = ['Inglés']
    toggleLanguage(base, 'Español')
    expect(base).toEqual(['Inglés'])
  })
  it('marcar dos veces seguidas el mismo no duplica', () => {
    expect(toggleLanguage(toggleLanguage([], 'Inglés'), 'Inglés')).toEqual([])
  })
})

describe('isSelected / atLimit / canContinue', () => {
  it('isSelected compara sin tildes', () => expect(isSelected(['Inglés'], 'INGLES')).toBe(true))
  it('atLimit', () => {
    expect(atLimit(Array(9).fill('x'))).toBe(false)
    expect(atLimit(Array(10).fill('x'))).toBe(true)
  })
  it('el onboarding exige 1 (0 no, 1 sí)', () => {
    expect(canContinue([])).toBe(false)
    expect(canContinue(['Español'])).toBe(true)
  })
})

describe('formatSpoken', () => {
  it('«Habla: español, inglés»', () => expect(formatSpoken(['Español', 'Inglés'])).toBe('Habla: español, inglés'))
  it('sin idiomas no muestra nada', () => {
    expect(formatSpoken([])).toBeNull()
    expect(formatSpoken(null)).toBeNull()
    expect(formatSpoken(undefined)).toBeNull()
    expect(formatSpoken(['  ', ''])).toBeNull()
  })
})

describe('needsSpokenLanguages (aviso suave)', () => {
  it('avisa solo a quien ya terminó el onboarding y no tiene idiomas', () => {
    expect(needsSpokenLanguages({ onboarding_completed: true, spoken_languages: [] })).toBe(true)
    expect(needsSpokenLanguages({ onboarding_completed: true })).toBe(true)
  })
  it('no avisa si tiene idiomas, si aún está en el onboarding o si no hay usuario', () => {
    expect(needsSpokenLanguages({ onboarding_completed: true, spoken_languages: ['Español'] })).toBe(false)
    expect(needsSpokenLanguages({ onboarding_completed: false, spoken_languages: [] })).toBe(false)
    expect(needsSpokenLanguages(null)).toBe(false)
  })
})

describe('sameLanguages', () => {
  it('ignora el orden y las tildes', () => {
    expect(sameLanguages(['Inglés', 'Español'], ['espanol', 'ingles'])).toBe(true)
  })
  it('distingue contenidos y tamaños', () => {
    expect(sameLanguages(['Inglés'], ['Inglés', 'Español'])).toBe(false)
    expect(sameLanguages(['Inglés'], ['Francés'])).toBe(false)
  })
})
