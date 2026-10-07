import { countries } from 'countries-list';

export interface CountryOption {
  code: string;
  name: string;
  dialCode: string;
}

export const COUNTRY_OPTIONS: CountryOption[] = Object.entries(countries)
  .flatMap(([code, country]) =>
    (country.phone || [])
      .filter((phoneCode) => !!phoneCode)
      .map((phoneCode) => ({
        code,
        name: country.name,
        dialCode: `+${phoneCode}`,
      }))
  )
  .sort((left, right) => left.name.localeCompare(right.name));
