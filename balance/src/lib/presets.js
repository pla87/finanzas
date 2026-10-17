// Cestas de gasto de referencia por país. Viven fuera de App.jsx porque el
// motor de cálculo las necesita para detectar desviaciones y no puede
// depender del componente.

export const COUNTRY_PRESETS = {
  es_urban: {
    name_es: 'España (Madrid / Barcelona)',
    name_en: 'Spain (Madrid / Barcelona)',
    person_monthly: { food: 300, clothes: 80, supplies_person: 80, transport: 200, other_person: 100 },
    household_monthly: { supplies: 220, subs: 50, otherHouse: 60 },
    family_annual: { housekeeper: 2000, education: 4000, vacations: 3000, vehicleMaint: 800, otherFixed: 1000 }
  },
  es_avg: {
    name_es: 'España (Media Nacional)',
    name_en: 'Spain (National Average)',
    person_monthly: { food: 250, clothes: 60, supplies_person: 50, transport: 120, other_person: 60 },
    household_monthly: { supplies: 180, subs: 35, otherHouse: 40 },
    family_annual: { housekeeper: 1500, education: 2500, vacations: 2000, vehicleMaint: 600, otherFixed: 600 }
  },
  us_avg: {
    name_es: 'Estados Unidos (Media)',
    name_en: 'United States (Average)',
    person_monthly: { food: 450, clothes: 120, supplies_person: 100, transport: 280, other_person: 150 },
    household_monthly: { supplies: 350, subs: 70, otherHouse: 150 },
    family_annual: { housekeeper: 3000, education: 6000, vacations: 4000, vehicleMaint: 1200, otherFixed: 1500 }
  },
  uk_avg: {
    name_es: 'Reino Unido (Media)',
    name_en: 'United Kingdom',
    person_monthly: { food: 320, clothes: 90, supplies_person: 70, transport: 190, other_person: 110 },
    household_monthly: { supplies: 280, subs: 50, otherHouse: 90 },
    family_annual: { housekeeper: 2500, education: 4500, vacations: 3500, vehicleMaint: 900, otherFixed: 1200 }
  }
};

// ¿Siguen los gastos siendo la cesta de referencia de un país, sin tocar?
// Sirve para decidir si avisar de que los gastos son una media y no los del
// usuario. Solo hace falta para quien ya tenía gastos guardados de antes de
// que existiera el aviso: de los demás se sabe porque se va apuntando.
// Compara campo a campo y en los dos sentidos, para que una clave de más o de
// menos cuente como gasto tocado.
export function isPresetBasket(expenses, countryKey) {
  const preset = COUNTRY_PRESETS[countryKey];
  if (!preset || !expenses) return false;
  return ['person_monthly', 'household_monthly', 'family_annual'].every(grupo => {
    const propio = expenses[grupo] || {};
    const claves = new Set([...Object.keys(propio), ...Object.keys(preset[grupo])]);
    return [...claves].every(k => Number(propio[k]) === Number(preset[grupo][k]));
  });
}
