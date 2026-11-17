import { describe, it, expect } from 'vitest'
import {
  MAX_SPOKEN_LANGUAGES, SPOKEN_LEVELS, LEVEL_LABELS, languageKey, parseSpoken, toggleLanguage, setLevel, isSelected,
  levelOf, allHaveLevel, canContinue, atLimit, formatSpoken, needsSpokenLanguages, sameLanguages,
  type SpokenLanguage,
} from '@/lib/spokenLanguages'

const sl = (language: string, level: SpokenLanguage['level'] = 'fluent'): SpokenLanguage => ({ language, level })
const many = (n: number): SpokenLanguage[] => Array.from({ length: n }, (_, i) => sl(`L${i}`))

describe('languageKey', () => {
  it('ignora mayúsculas, tildes y espacios', () => {
    expect(languageKey(' INGLÉS ')).toBe('ingles')
    expect(languageKey('Español')).toBe(languageKey('espanol'))
  })
})

describe('niveles', () => {
  it('hay 4, del más alto al más bajo, y todos con etiqueta', () => {
    expect(SPOKEN_LEVELS).toEqual(['native', 'fluent', 'intermediate', 'basic'])
    for (const l of SPOKEN_LEVELS) expect(LEVEL_LABELS[l]).toBeTruthy()
  })
})

describe('parseSpoken', () => {
  it('lee objetos, textos sueltos antiguos y descarta basura', () => {
    expect(parseSpoken([sl('Inglés', 'native'), 'Español', { language: 'Francés', level: 'raro' }, 7, null, '', { x: 1 }])).toEqual([
      sl('Inglés', 'native'), sl('Español', null), sl('Francés', null),
    ])
  })
  it('lo que no es lista da []', () => {
    expect(parseSpoken(undefined)).toEqual([])
    expect(parseSpoken('Inglés')).toEqual([])
  })
})

describe('toggleLanguage', () => {
  it('un idioma nuevo entra SIN nivel (el usuario lo elige)', () => {
    expect(toggleLanguage([], 'Inglés')).toEqual([{ language: 'Inglés', level: null }])
  })
  it('desmarca (y pierde su nivel)', () => {
    expect(toggleLanguage([sl('Inglés')], 'Inglés')).toEqual([])
  })
  it('desmarca aunque cambie la capitalización o la tilde, sin tocar los demás', () => {
    expect(toggleLanguage([sl('Inglés'), sl('Español', 'native')], 'ingles')).toEqual([sl('Español', 'native')])
  })
  it('no pasa del máximo (10 sí, 11 no)', () => {
    const ten = toggleLanguage(many(9), 'L9')
    expect(ten).toHaveLength(MAX_SPOKEN_LANGUAGES)
    expect(toggleLanguage(ten, 'L10')).toEqual(ten)
  })
  it('con el máximo lleno todavía se puede desmarcar', () => {
    expect(toggleLanguage(many(10), 'L3')).toHaveLength(9)
  })
  it('no muta la lista original', () => {
    const base = [sl('Inglés')]
    toggleLanguage(base, 'Español')
    expect(base).toEqual([sl('Inglés')])
  })
  it('marcar y desmarcar el mismo no deja rastro', () => {
    expect(toggleLanguage(toggleLanguage([], 'Inglés'), 'Inglés')).toEqual([])
  })
})

describe('setLevel', () => {
  it('cambia solo el nivel del idioma indicado', () => {
    expect(setLevel([sl('Inglés', null), sl('Español', 'native')], 'inglés', 'basic')).toEqual([sl('Inglés', 'basic'), sl('Español', 'native')])
  })
  it('si el idioma no está, no cambia nada; y no muta', () => {
    const base = [sl('Inglés')]
    expect(setLevel(base, 'Francés', 'basic')).toEqual(base)
    setLevel(base, 'Inglés', 'basic')
    expect(base).toEqual([sl('Inglés')])
  })
})

describe('isSelected / levelOf / atLimit', () => {
  it('compara sin tildes', () => {
    expect(isSelected([sl('Inglés')], 'INGLES')).toBe(true)
    expect(levelOf([sl('Inglés', 'basic')], 'ingles')).toBe('basic')
    expect(levelOf([sl('Inglés', null)], 'Inglés')).toBeNull()
    expect(levelOf([], 'Inglés')).toBeNull()
  })
  it('atLimit', () => {
    expect(atLimit(many(9))).toBe(false)
    expect(atLimit(many(10))).toBe(true)
  })
})

describe('allHaveLevel / canContinue', () => {
  it('el onboarding exige 1 idioma Y que todos tengan nivel', () => {
    expect(canContinue([])).toBe(false)
    expect(canContinue([sl('Español', null)])).toBe(false)
    expect(canContinue([sl('Español', 'native'), sl('Inglés', null)])).toBe(false)
    expect(canContinue([sl('Español', 'native')])).toBe(true)
  })
  it('la lista vacía cumple allHaveLevel (guardar «ninguno» es válido en el perfil)', () => {
    expect(allHaveLevel([])).toBe(true)
  })
})

describe('formatSpoken', () => {
  it('«Habla: español (nativo), inglés (intermedio)»', () => {
    expect(formatSpoken([sl('Español', 'native'), sl('Inglés', 'intermediate')])).toBe('Habla: español (nativo), inglés (intermedio)')
  })
  it('sin nivel (datos antiguos) muestra solo el nombre', () => {
    expect(formatSpoken([sl('Español', null), sl('Inglés', 'basic')])).toBe('Habla: español, inglés (básico)')
  })
  it('acepta textos sueltos antiguos que lleguen de la API', () => {
    expect(formatSpoken(['Español'] as unknown as SpokenLanguage[])).toBe('Habla: español')
  })
  it('sin idiomas no muestra nada', () => {
    expect(formatSpoken([])).toBeNull()
    expect(formatSpoken(null)).toBeNull()
    expect(formatSpoken(undefined)).toBeNull()
    expect(formatSpoken([sl('  '), sl('')])).toBeNull()
  })
})

describe('needsSpokenLanguages (aviso suave)', () => {
  it('avisa a quien ya terminó el onboarding y no tiene idiomas', () => {
    expect(needsSpokenLanguages({ onboarding_completed: true, spoken_languages: [] })).toBe(true)
    expect(needsSpokenLanguages({ onboarding_completed: true })).toBe(true)
  })
  it('avisa también si algún idioma sigue sin nivel (datos de la Fase 8)', () => {
    expect(needsSpokenLanguages({ onboarding_completed: true, spoken_languages: [sl('Español', 'native'), sl('Inglés', null)] })).toBe(true)
  })
  it('no avisa si todo está completo, si aún está en el onboarding o si no hay usuario', () => {
    expect(needsSpokenLanguages({ onboarding_completed: true, spoken_languages: [sl('Español', 'native')] })).toBe(false)
    expect(needsSpokenLanguages({ onboarding_completed: false, spoken_languages: [] })).toBe(false)
    expect(needsSpokenLanguages(null)).toBe(false)
  })
})

describe('sameLanguages', () => {
  it('ignora el orden y las tildes', () => {
    expect(sameLanguages([sl('Inglés'), sl('Español')], [sl('espanol'), sl('ingles')])).toBe(true)
  })
  it('distingue contenidos, tamaños y NIVELES', () => {
    expect(sameLanguages([sl('Inglés')], [sl('Inglés'), sl('Español')])).toBe(false)
    expect(sameLanguages([sl('Inglés')], [sl('Francés')])).toBe(false)
    expect(sameLanguages([sl('Inglés', 'basic')], [sl('Inglés', 'native')])).toBe(false)
    expect(sameLanguages([sl('Inglés', null)], [sl('Inglés', 'native')])).toBe(false)
  })
})
