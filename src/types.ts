export interface World {
  name: string;
  host: string | null;
  dist_ly: number | null;   // distance from Earth, light-years
  radius: number | null;    // planet radius, Earth radii
  mass: number | null;      // planet mass, Earth masses
  density: number | null;   // g/cm^3
  teq: number | null;       // equilibrium temperature, Kelvin
  insol: number | null;     // insolation flux, relative to Earth
  period: number | null;    // orbital period, days
  smax: number | null;      // semi-major axis, AU
  ecc: number | null;       // orbital eccentricity
  year: number | null;      // discovery year
  method: string | null;    // discovery method
  facility: string | null;  // discovery facility
  st_teff: number | null;   // host star temperature, K
  st_rad: number | null;    // host star radius, solar radii
  st_mass: number | null;   // host star mass, solar masses
  spectype: string | null;  // host star spectral type
  snum: number | null;      // stars in the system
  pnum: number | null;      // planets in the system
  ra: number | null;        // right ascension, deg
  dec: number | null;       // declination, deg
  esi: number | null;       // rough Earth-likeness, 0..1
  hz: boolean;              // in the temperate Earth-size band
}

export interface Meta {
  generated: string;
  source: string;
  total: number;
  with_radius: number;
  with_teq: number;
  with_distance: number;
  habitable_band: number;
  first_year: number;
  latest_year: number;
  methods: [string, number][];
}
