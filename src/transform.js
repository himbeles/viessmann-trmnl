// TRMNL Serverless (Node): reduce the full feature response before storage/rendering.
// Keep only dashboard readings and the few runtime settings used by the markup.
function run(input) {
  const source = input && typeof input === 'object' ? input : {};
  const cfg = source.trmnl?.plugin_settings?.custom_fields_values || {};
  const text = (value, fallback, limit = 256) => typeof value === 'string' && value.length > 0 && value.length <= limit ? value : fallback;
  const numeric = value => typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const circuit = text(String(cfg.circuit ?? '0'), '0', 8);
  const features = Array.isArray(source.IDX_0?.data) ? source.IDX_0.data : Array.isArray(source.data) ? source.data : [];
  const circuitSupply = `heating.circuits.${circuit}.sensors.temperature.supply`;
  const deviceSupply = 'heating.secondaryCircuit.sensors.temperature.supply';
  const requestedSupply = text(cfg.supply_feature, 'auto');
  // Migrate the previous default to automatic circuit-first selection.
  const automaticSupply = requestedSupply === 'auto' || requestedSupply === deviceSupply;
  const usableCircuitSupply = features.some(item => item?.feature === circuitSupply && item.isEnabled !== false
    && !['error', 'disconnected', 'unavailable'].includes(item.properties?.status?.value)
    && numeric(item.properties?.value?.value) != null);
  const selectedSupply = automaticSupply ? (usableCircuitSupply ? circuitSupply : deviceSupply) : requestedSupply;
  const settings = {
    language: cfg.language === 'de' ? 'de' : 'en',
    circuit,
    supply_feature: selectedSupply,
    water_feature: text(cfg.water_feature, 'heating.dhw.sensors.temperature.dhwCylinder'),
    outside_feature: text(cfg.outside_feature, 'heating.sensors.temperature.outside'),
    stale_minutes: numeric(cfg.stale_minutes) ?? 120,
    time_zone: text(cfg.time_zone, 'Europe/Berlin', 100),
    supply_setpoint_feature: text(cfg.supply_setpoint_feature, ''),
    water_setpoint_feature: text(cfg.water_setpoint_feature, 'heating.dhw.temperature.main'),
    curve_points: text(cfg.curve_points, '', 8000),
    max_supply_temperature: numeric(cfg.max_supply_temperature),
    current_power_feature: text(cfg.current_power_feature, ''),
    daily_energy_feature: text(cfg.daily_energy_feature, ''),
    current_heat_feature: text(cfg.current_heat_feature, ''),
    daily_heat_feature: text(cfg.daily_heat_feature, '')
  };
  const fields = new Map([
    [settings.supply_feature, ['value', 'status']],
    [settings.water_feature, ['value', 'status']],
    [settings.outside_feature, ['value', 'status']],
    [`heating.circuits.${circuit}.heating.curve`, ['slope', 'shift']],
    [`heating.circuits.${circuit}.operating.modes.active`, ['value']]
  ]);
  const prefix = `heating.circuits.${circuit}`;
  const active = features.find(item => item?.feature === `${prefix}.operating.programs.active` && item.isEnabled !== false);
  const program = text(active?.properties?.value?.value, null, 80);
  fields.set(`${prefix}.circulation.pump`, ['status']);
  fields.set('heating.dhw.charging', ['active', 'status']);
  fields.set('heating.secondaryCircuit.operation.state', ['currentValue', 'status']);
  fields.set('heating.valves.fourThreeWay.position', ['value', 'status']);
  fields.set('heating.sensors.pressure.supply', ['value', 'status']);
  const circuitReturn = `${prefix}.sensors.temperature.return`;
  const selectedReturn = features.some(item => item?.feature === circuitReturn && item.isEnabled !== false
    && !['error', 'disconnected', 'unavailable'].includes(item.properties?.status?.value)
    && numeric(item.properties?.value?.value) != null) ? circuitReturn : 'heating.sensors.temperature.return';
  fields.set(selectedReturn, ['value', 'status']);
  fields.set(`${prefix}.operating.programs.active`, ['value']);
  fields.set(`${prefix}.operating.programs.normal`, ['temperature']);
  fields.set(`${prefix}.operating.programs.normalHeating`, ['temperature']);
  fields.set(`${prefix}.temperature.levels`, ['min', 'max']);
  fields.set(`${prefix}.temperature`, ['value', 'status']);
  if (program) fields.set(`${prefix}.operating.programs.${program}`, ['temperature']);
  if (settings.supply_setpoint_feature) fields.set(settings.supply_setpoint_feature, ['value', 'status']);
  fields.set(settings.water_setpoint_feature, ['value', 'status']);
  const data = [];
  for (const [name, keys] of fields) {
    const feature = features.find(item => item && item.feature === name);
    if (!feature) continue;
    const mode = name.endsWith('.operating.modes.active') || name.endsWith('.operating.programs.active') || name === 'heating.valves.fourThreeWay.position';
    const properties = {};
    for (const key of keys) {
      const raw = feature.properties?.[key]?.value;
      properties[key] = { value: key === 'active' ? (typeof raw === 'boolean' ? raw : null)
        : key === 'status' || key === 'currentValue' || mode ? text(raw, null, 128) : numeric(raw) };
      if (name === 'heating.sensors.pressure.supply' && key === 'value') {
        properties[key].unit = text(feature.properties?.[key]?.unit, null, 32);
      }
    }
    const reading = { feature: name, isEnabled: feature.isEnabled !== false, properties };
    const timestamp = text(feature.timestamp, null, 64);
    if (timestamp) reading.timestamp = timestamp;
    data.push(reading);
  }
  const result = {
    data,
    trmnl: {
      // Hosted Serverless omits trmnl.system; use the VM clock in that case.
      system: { timestamp_utc: numeric(source.trmnl?.system?.timestamp_utc) > 0
        ? numeric(source.trmnl.system.timestamp_utc) : Math.floor(Date.now() / 1000) },
      plugin_settings: { custom_fields_values: settings }
    }
  };
  const valid = name => data.find(item => item.feature === name && item.isEnabled && !['error', 'disconnected', 'unavailable'].includes(item.properties.status?.value));
  const value = name => valid(name)?.properties?.value?.value ?? null;
  const room = program && program !== 'standby' ? valid(`${prefix}.operating.programs.${program}`)?.properties?.temperature?.value ?? null : null;
  const pumpStatus = valid(`${prefix}.circulation.pump`)?.properties?.status?.value;
  result.return_reading = { value: value(selectedReturn), scope: selectedReturn === circuitReturn ? 'circuit' : 'heat_pump' };
  result.supply_reading = { feature: selectedSupply, value: value(selectedSupply) };
  result.supply_scope = selectedSupply === circuitSupply ? 'circuit' : selectedSupply === deviceSupply ? 'heat_pump' : 'custom';
  result.heating = { state: pumpStatus === 'on' || pumpStatus === 'off' ? pumpStatus : 'unknown' };
  const operation = valid('heating.secondaryCircuit.operation.state')?.properties?.currentValue?.value;
  const charging = valid('heating.dhw.charging')?.properties?.active?.value;
  const valve = value('heating.valves.fourThreeWay.position');
  // Current state describes activity; valve position alone may persist while idle.
  let activity = 'unknown';
  if (charging === true || ['dhw', 'domesticHotWater'].includes(operation)) activity = 'dhw';
  else if (['standby', 'off'].includes(operation)) activity = 'off';
  else if (operation === 'heating') activity = valve === 'domesticHotWater' ? 'dhw' : 'heating';
  else if (operation == null && pumpStatus === 'on' && charging === false) activity = 'heating';
  else if (operation == null && pumpStatus === 'off' && charging === false) activity = 'off';
  result.activity = { state: activity };
  result.setpoints = { room, supply: value(settings.supply_setpoint_feature) ?? value(`${prefix}.temperature`), water: value(settings.water_setpoint_feature) };

  // Configuration timestamps describe setting changes, not sensor freshness.
  const sensors = [settings.supply_feature, settings.water_feature, settings.outside_feature].map(valid).filter(item => item && item.properties.value?.value != null);
  const times = sensors.map(item => Date.parse(item.timestamp));
  const knownTimes = times.filter(Number.isFinite);
  const oldest = knownTimes.length ? Math.min(...knownTimes) : null;
  const now = result.trmnl.system.timestamp_utc * 1000;
  let timeZone = settings.time_zone;
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { timeZone = 'UTC'; }
  settings.time_zone = timeZone;
  // IANA zone.tab country assignments (public domain, 2026-10-18), plus ICU aliases.
  // https://data.iana.org/time-zones/tzdb/zone.tab
  // Intl supplies the regional date pattern; display language remains independent.
  const dateRegions = {
    "Africa/Abidjan": "CI", "Africa/Accra": "GH", "Africa/Addis_Ababa": "ET",
    "Africa/Algiers": "DZ", "Africa/Asmara": "ER", "Africa/Asmera": "ER",
    "Africa/Bamako": "ML", "Africa/Bangui": "CF", "Africa/Banjul": "GM",
    "Africa/Bissau": "GW", "Africa/Blantyre": "MW", "Africa/Brazzaville": "CG",
    "Africa/Bujumbura": "BI", "Africa/Cairo": "EG", "Africa/Casablanca": "MA",
    "Africa/Ceuta": "ES", "Africa/Conakry": "GN", "Africa/Dakar": "SN",
    "Africa/Dar_es_Salaam": "TZ", "Africa/Djibouti": "DJ", "Africa/Douala": "CM",
    "Africa/El_Aaiun": "EH", "Africa/Freetown": "SL", "Africa/Gaborone": "BW",
    "Africa/Harare": "ZW", "Africa/Johannesburg": "ZA", "Africa/Juba": "SS",
    "Africa/Kampala": "UG", "Africa/Khartoum": "SD", "Africa/Kigali": "RW",
    "Africa/Kinshasa": "CD", "Africa/Lagos": "NG", "Africa/Libreville": "GA",
    "Africa/Lome": "TG", "Africa/Luanda": "AO", "Africa/Lubumbashi": "CD",
    "Africa/Lusaka": "ZM", "Africa/Malabo": "GQ", "Africa/Maputo": "MZ",
    "Africa/Maseru": "LS", "Africa/Mbabane": "SZ", "Africa/Mogadishu": "SO",
    "Africa/Monrovia": "LR", "Africa/Nairobi": "KE", "Africa/Ndjamena": "TD",
    "Africa/Niamey": "NE", "Africa/Nouakchott": "MR", "Africa/Ouagadougou": "BF",
    "Africa/Porto-Novo": "BJ", "Africa/Sao_Tome": "ST", "Africa/Tripoli": "LY",
    "Africa/Tunis": "TN", "Africa/Windhoek": "NA", "America/Adak": "US",
    "America/Anchorage": "US", "America/Anguilla": "AI", "America/Antigua": "AG",
    "America/Araguaina": "BR", "America/Argentina/Buenos_Aires": "AR", "America/Argentina/Catamarca": "AR",
    "America/Argentina/Cordoba": "AR", "America/Argentina/Jujuy": "AR", "America/Argentina/La_Rioja": "AR",
    "America/Argentina/Mendoza": "AR", "America/Argentina/Rio_Gallegos": "AR", "America/Argentina/Salta": "AR",
    "America/Argentina/San_Juan": "AR", "America/Argentina/San_Luis": "AR", "America/Argentina/Tucuman": "AR",
    "America/Argentina/Ushuaia": "AR", "America/Aruba": "AW", "America/Asuncion": "PY",
    "America/Atikokan": "CA", "America/Bahia": "BR", "America/Bahia_Banderas": "MX",
    "America/Barbados": "BB", "America/Belem": "BR", "America/Belize": "BZ",
    "America/Blanc-Sablon": "CA", "America/Boa_Vista": "BR", "America/Bogota": "CO",
    "America/Boise": "US", "America/Buenos_Aires": "AR", "America/Cambridge_Bay": "CA",
    "America/Campo_Grande": "BR", "America/Cancun": "MX", "America/Caracas": "VE",
    "America/Catamarca": "AR", "America/Cayenne": "GF", "America/Cayman": "KY",
    "America/Chicago": "US", "America/Chihuahua": "MX", "America/Ciudad_Juarez": "MX",
    "America/Coral_Harbour": "CA", "America/Cordoba": "AR", "America/Costa_Rica": "CR",
    "America/Coyhaique": "CL", "America/Creston": "CA", "America/Cuiaba": "BR",
    "America/Curacao": "CW", "America/Danmarkshavn": "GL", "America/Dawson": "CA",
    "America/Dawson_Creek": "CA", "America/Denver": "US", "America/Detroit": "US",
    "America/Dominica": "DM", "America/Edmonton": "CA", "America/Eirunepe": "BR",
    "America/El_Salvador": "SV", "America/Fort_Nelson": "CA", "America/Fortaleza": "BR",
    "America/Glace_Bay": "CA", "America/Godthab": "GL", "America/Goose_Bay": "CA",
    "America/Grand_Turk": "TC", "America/Grenada": "GD", "America/Guadeloupe": "GP",
    "America/Guatemala": "GT", "America/Guayaquil": "EC", "America/Guyana": "GY",
    "America/Halifax": "CA", "America/Havana": "CU", "America/Hermosillo": "MX",
    "America/Indiana/Indianapolis": "US", "America/Indiana/Knox": "US", "America/Indiana/Marengo": "US",
    "America/Indiana/Petersburg": "US", "America/Indiana/Tell_City": "US", "America/Indiana/Vevay": "US",
    "America/Indiana/Vincennes": "US", "America/Indiana/Winamac": "US", "America/Indianapolis": "US",
    "America/Inuvik": "CA", "America/Iqaluit": "CA", "America/Jamaica": "JM",
    "America/Jujuy": "AR", "America/Juneau": "US", "America/Kentucky/Louisville": "US",
    "America/Kentucky/Monticello": "US", "America/Kralendijk": "BQ", "America/La_Paz": "BO",
    "America/Lima": "PE", "America/Los_Angeles": "US", "America/Louisville": "US",
    "America/Lower_Princes": "SX", "America/Maceio": "BR", "America/Managua": "NI",
    "America/Manaus": "BR", "America/Marigot": "MF", "America/Martinique": "MQ",
    "America/Matamoros": "MX", "America/Mazatlan": "MX", "America/Mendoza": "AR",
    "America/Menominee": "US", "America/Merida": "MX", "America/Metlakatla": "US",
    "America/Mexico_City": "MX", "America/Miquelon": "PM", "America/Moncton": "CA",
    "America/Monterrey": "MX", "America/Montevideo": "UY", "America/Montserrat": "MS",
    "America/Nassau": "BS", "America/New_York": "US", "America/Nome": "US",
    "America/Noronha": "BR", "America/North_Dakota/Beulah": "US", "America/North_Dakota/Center": "US",
    "America/North_Dakota/New_Salem": "US", "America/Nuuk": "GL", "America/Ojinaga": "MX",
    "America/Panama": "PA", "America/Paramaribo": "SR", "America/Phoenix": "US",
    "America/Port_of_Spain": "TT", "America/Port-au-Prince": "HT", "America/Porto_Velho": "BR",
    "America/Puerto_Rico": "PR", "America/Punta_Arenas": "CL", "America/Rankin_Inlet": "CA",
    "America/Recife": "BR", "America/Regina": "CA", "America/Resolute": "CA",
    "America/Rio_Branco": "BR", "America/Santarem": "BR", "America/Santiago": "CL",
    "America/Santo_Domingo": "DO", "America/Sao_Paulo": "BR", "America/Scoresbysund": "GL",
    "America/Sitka": "US", "America/St_Barthelemy": "BL", "America/St_Johns": "CA",
    "America/St_Kitts": "KN", "America/St_Lucia": "LC", "America/St_Thomas": "VI",
    "America/St_Vincent": "VC", "America/Swift_Current": "CA", "America/Tegucigalpa": "HN",
    "America/Thule": "GL", "America/Tijuana": "MX", "America/Toronto": "CA",
    "America/Tortola": "VG", "America/Vancouver": "CA", "America/Whitehorse": "CA",
    "America/Winnipeg": "CA", "America/Yakutat": "US", "Antarctica/Casey": "AQ",
    "Antarctica/Davis": "AQ", "Antarctica/DumontDUrville": "AQ", "Antarctica/Macquarie": "AU",
    "Antarctica/Mawson": "AQ", "Antarctica/McMurdo": "AQ", "Antarctica/Palmer": "AQ",
    "Antarctica/Rothera": "AQ", "Antarctica/Syowa": "AQ", "Antarctica/Troll": "AQ",
    "Antarctica/Vostok": "AQ", "Arctic/Longyearbyen": "SJ", "Asia/Aden": "YE",
    "Asia/Almaty": "KZ", "Asia/Amman": "JO", "Asia/Anadyr": "RU",
    "Asia/Aqtau": "KZ", "Asia/Aqtobe": "KZ", "Asia/Ashgabat": "TM",
    "Asia/Atyrau": "KZ", "Asia/Baghdad": "IQ", "Asia/Bahrain": "BH",
    "Asia/Baku": "AZ", "Asia/Bangkok": "TH", "Asia/Barnaul": "RU",
    "Asia/Beirut": "LB", "Asia/Bishkek": "KG", "Asia/Brunei": "BN",
    "Asia/Calcutta": "IN", "Asia/Chita": "RU", "Asia/Colombo": "LK",
    "Asia/Damascus": "SY", "Asia/Dhaka": "BD", "Asia/Dili": "TL",
    "Asia/Dubai": "AE", "Asia/Dushanbe": "TJ", "Asia/Famagusta": "CY",
    "Asia/Gaza": "PS", "Asia/Hebron": "PS", "Asia/Ho_Chi_Minh": "VN",
    "Asia/Hong_Kong": "HK", "Asia/Hovd": "MN", "Asia/Irkutsk": "RU",
    "Asia/Jakarta": "ID", "Asia/Jayapura": "ID", "Asia/Jerusalem": "IL",
    "Asia/Kabul": "AF", "Asia/Kamchatka": "RU", "Asia/Karachi": "PK",
    "Asia/Kathmandu": "NP", "Asia/Katmandu": "NP", "Asia/Khandyga": "RU",
    "Asia/Kolkata": "IN", "Asia/Krasnoyarsk": "RU", "Asia/Kuala_Lumpur": "MY",
    "Asia/Kuching": "MY", "Asia/Kuwait": "KW", "Asia/Macau": "MO",
    "Asia/Magadan": "RU", "Asia/Makassar": "ID", "Asia/Manila": "PH",
    "Asia/Muscat": "OM", "Asia/Nicosia": "CY", "Asia/Novokuznetsk": "RU",
    "Asia/Novosibirsk": "RU", "Asia/Omsk": "RU", "Asia/Oral": "KZ",
    "Asia/Phnom_Penh": "KH", "Asia/Pontianak": "ID", "Asia/Pyongyang": "KP",
    "Asia/Qatar": "QA", "Asia/Qostanay": "KZ", "Asia/Qyzylorda": "KZ",
    "Asia/Rangoon": "MM", "Asia/Riyadh": "SA", "Asia/Saigon": "VN",
    "Asia/Sakhalin": "RU", "Asia/Samarkand": "UZ", "Asia/Seoul": "KR",
    "Asia/Shanghai": "CN", "Asia/Singapore": "SG", "Asia/Srednekolymsk": "RU",
    "Asia/Taipei": "TW", "Asia/Tashkent": "UZ", "Asia/Tbilisi": "GE",
    "Asia/Tehran": "IR", "Asia/Thimphu": "BT", "Asia/Tokyo": "JP",
    "Asia/Tomsk": "RU", "Asia/Ulaanbaatar": "MN", "Asia/Urumqi": "CN",
    "Asia/Ust-Nera": "RU", "Asia/Vientiane": "LA", "Asia/Vladivostok": "RU",
    "Asia/Yakutsk": "RU", "Asia/Yangon": "MM", "Asia/Yekaterinburg": "RU",
    "Asia/Yerevan": "AM", "Atlantic/Azores": "PT", "Atlantic/Bermuda": "BM",
    "Atlantic/Canary": "ES", "Atlantic/Cape_Verde": "CV", "Atlantic/Faeroe": "FO",
    "Atlantic/Faroe": "FO", "Atlantic/Madeira": "PT", "Atlantic/Reykjavik": "IS",
    "Atlantic/South_Georgia": "GS", "Atlantic/St_Helena": "SH", "Atlantic/Stanley": "FK",
    "Australia/Adelaide": "AU", "Australia/Brisbane": "AU", "Australia/Broken_Hill": "AU",
    "Australia/Darwin": "AU", "Australia/Eucla": "AU", "Australia/Hobart": "AU",
    "Australia/Lindeman": "AU", "Australia/Lord_Howe": "AU", "Australia/Melbourne": "AU",
    "Australia/Perth": "AU", "Australia/Sydney": "AU", "Europe/Amsterdam": "NL",
    "Europe/Andorra": "AD", "Europe/Astrakhan": "RU", "Europe/Athens": "GR",
    "Europe/Belgrade": "RS", "Europe/Berlin": "DE", "Europe/Bratislava": "SK",
    "Europe/Brussels": "BE", "Europe/Bucharest": "RO", "Europe/Budapest": "HU",
    "Europe/Busingen": "DE", "Europe/Chisinau": "MD", "Europe/Copenhagen": "DK",
    "Europe/Dublin": "IE", "Europe/Gibraltar": "GI", "Europe/Guernsey": "GG",
    "Europe/Helsinki": "FI", "Europe/Isle_of_Man": "IM", "Europe/Istanbul": "TR",
    "Europe/Jersey": "JE", "Europe/Kaliningrad": "RU", "Europe/Kiev": "UA",
    "Europe/Kirov": "RU", "Europe/Kyiv": "UA", "Europe/Lisbon": "PT",
    "Europe/Ljubljana": "SI", "Europe/London": "GB", "Europe/Luxembourg": "LU",
    "Europe/Madrid": "ES", "Europe/Malta": "MT", "Europe/Mariehamn": "AX",
    "Europe/Minsk": "BY", "Europe/Monaco": "MC", "Europe/Moscow": "RU",
    "Europe/Oslo": "NO", "Europe/Paris": "FR", "Europe/Podgorica": "ME",
    "Europe/Prague": "CZ", "Europe/Riga": "LV", "Europe/Rome": "IT",
    "Europe/Samara": "RU", "Europe/San_Marino": "SM", "Europe/Sarajevo": "BA",
    "Europe/Saratov": "RU", "Europe/Simferopol": "UA", "Europe/Skopje": "MK",
    "Europe/Sofia": "BG", "Europe/Stockholm": "SE", "Europe/Tallinn": "EE",
    "Europe/Tirane": "AL", "Europe/Ulyanovsk": "RU", "Europe/Vaduz": "LI",
    "Europe/Vatican": "VA", "Europe/Vienna": "AT", "Europe/Vilnius": "LT",
    "Europe/Volgograd": "RU", "Europe/Warsaw": "PL", "Europe/Zagreb": "HR",
    "Europe/Zurich": "CH", "Indian/Antananarivo": "MG", "Indian/Chagos": "IO",
    "Indian/Christmas": "CX", "Indian/Cocos": "CC", "Indian/Comoro": "KM",
    "Indian/Kerguelen": "TF", "Indian/Mahe": "SC", "Indian/Maldives": "MV",
    "Indian/Mauritius": "MU", "Indian/Mayotte": "YT", "Indian/Reunion": "RE",
    "Pacific/Apia": "WS", "Pacific/Auckland": "NZ", "Pacific/Bougainville": "PG",
    "Pacific/Chatham": "NZ", "Pacific/Chuuk": "FM", "Pacific/Easter": "CL",
    "Pacific/Efate": "VU", "Pacific/Enderbury": "KI", "Pacific/Fakaofo": "TK",
    "Pacific/Fiji": "FJ", "Pacific/Funafuti": "TV", "Pacific/Galapagos": "EC",
    "Pacific/Gambier": "PF", "Pacific/Guadalcanal": "SB", "Pacific/Guam": "GU",
    "Pacific/Honolulu": "US", "Pacific/Kanton": "KI", "Pacific/Kiritimati": "KI",
    "Pacific/Kosrae": "FM", "Pacific/Kwajalein": "MH", "Pacific/Majuro": "MH",
    "Pacific/Marquesas": "PF", "Pacific/Midway": "UM", "Pacific/Nauru": "NR",
    "Pacific/Niue": "NU", "Pacific/Norfolk": "NF", "Pacific/Noumea": "NC",
    "Pacific/Pago_Pago": "AS", "Pacific/Palau": "PW", "Pacific/Pitcairn": "PN",
    "Pacific/Pohnpei": "FM", "Pacific/Ponape": "FM", "Pacific/Port_Moresby": "PG",
    "Pacific/Rarotonga": "CK", "Pacific/Saipan": "MP", "Pacific/Tahiti": "PF",
    "Pacific/Tarawa": "KI", "Pacific/Tongatapu": "TO", "Pacific/Truk": "FM",
    "Pacific/Wake": "UM", "Pacific/Wallis": "WF",
  };
  const canonicalZone = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  const dateRegion = dateRegions[timeZone] || dateRegions[canonicalZone];
  const dateLanguage = dateRegion ? new Intl.Locale('und', { region: dateRegion }).maximize().language : null;
  // UTC and fixed-offset zones have no country: use an unambiguous ISO-style date.
  const dateLocale = dateRegion ? dateLanguage + '-' + dateRegion : 'sv-SE';
  const dateFormatter = new Intl.DateTimeFormat(dateLocale, {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', calendar: 'gregory', numberingSystem: 'latn'
  });
  const formatTime = timestamp => timestamp === null || !Number.isFinite(timestamp) ? null : dateFormatter.format(timestamp);
  result.freshness = {
    oldest_sensor: formatTime(oldest), time_zone: timeZone, date_locale: dateLocale,
    missing_time: sensors.length === 0 || knownTimes.length !== sensors.length,
    stale: oldest !== null && now > 0 && now - oldest > settings.stale_minutes * 60000
  };

  const displayTimes = [...knownTimes];
  const rememberTime = timestamp => {
    if (Number.isFinite(timestamp)) displayTimes.push(timestamp);
  };
  if (result.return_reading.value != null) rememberTime(Date.parse(valid(selectedReturn)?.timestamp));

  // Electrical input and thermal output are separate quantities, never inferred from COP.
  const convert = (property, quantity) => {
    const amount = numeric(property?.value);
    if (amount == null || amount < 0) return null;
    const unit = String(property?.unit || '').toLowerCase().replace(/[^a-z]/g, '');
    if (quantity === 'power') {
      if (['kw', 'kilowatt', 'kilowatts'].includes(unit)) return amount;
      if (['w', 'watt', 'watts'].includes(unit)) return amount / 1000;
    } else {
      if (['kwh', 'kilowatthour', 'kilowatthours'].includes(unit)) return amount;
      if (['wh', 'watthour', 'watthours'].includes(unit)) return amount / 1000;
    }
    return null;
  };
  const calendarDate = timestamp => {
    if (!Number.isFinite(timestamp)) return null;
    const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
  };
  const today = now > 0 ? calendarDate(now) : null;
  const readEnergy = (base, currentFeature, dailyFeature) => {
    const rawFeature = name => typeof name === 'string' && name.includes(`.${base}.`)
      ? features.find(item => item?.feature === name && item.isEnabled !== false && item.properties?.status?.value !== 'error') : null;
    const powerNames = currentFeature ? [currentFeature] : [
      `heating.${base}.current`, `heating.compressors.0.${base}.current`
    ];
    const metrics = { power_kw: null, today_kwh: null, today_date: today };
    for (const name of powerNames) {
      const item = rawFeature(name);
      const amount = convert(item?.properties?.value, 'power');
      if (amount == null) continue;
      const timestamp = Date.parse(item.timestamp);
      rememberTime(timestamp);
      metrics.power_kw = amount;
      metrics.power_scope = name.includes('.compressors.') ? 'compressor' : name.includes('.heatingRod.') ? 'heater' : 'device';
      metrics.power_updated = formatTime(Number.isFinite(timestamp) ? timestamp : null);
      metrics.power_stale = Number.isFinite(timestamp) && now > 0 && now - timestamp > settings.stale_minutes * 60000;
      break;
    }
    let outdatedEnergy = false;
    const readDay = name => {
      const item = rawFeature(name);
      if (!item) return null;
      let property = item.properties?.currentDay;
      if (!property && Array.isArray(item.properties?.day?.value)) {
        // Viessmann day arrays start with the running day, followed by previous days.
        property = { ...item.properties.day, value: item.properties.day.value[0] };
      }
      if (!property && name.endsWith('.day')) property = item.properties?.value;
      const amount = convert(property, 'energy');
      if (amount == null) return null;
      const timestamp = Date.parse(item.timestamp);
      if (today == null || calendarDate(timestamp) !== today) {
        outdatedEnergy = true;
        return null;
      }
      return { amount, timestamp };
    };
    const firstDay = names => {
      for (const name of names) {
        const reading = readDay(name);
        if (reading) return reading;
      }
      return null;
    };
    // Read both uses even when a separate whole-device total is available.
    metrics.by_use = {};
    for (const scope of ['heating', 'dhw']) {
      const reading = firstDay([`heating.${base}.summary.${scope}`, `heating.${base}.${scope}`]);
      if (reading) {
        rememberTime(reading.timestamp);
        metrics.by_use[scope] = { today_kwh: Math.round(reading.amount * 1000) / 1000,
          stale: now - reading.timestamp > settings.stale_minutes * 60000 };
      }
    }
    let daily;
    let dailyScope = 'device';
    if (dailyFeature) {
      daily = readDay(dailyFeature);
      if (dailyFeature.includes('.compressors.')) dailyScope = 'compressor';
      else if (dailyFeature.includes('.heatingRod.')) dailyScope = 'heater';
      else if (dailyFeature.endsWith('.heating')) dailyScope = 'heating';
      else if (dailyFeature.endsWith('.dhw')) dailyScope = 'dhw';
      else if (dailyFeature.endsWith('.cooling')) dailyScope = 'cooling';
    } else {
      // The official catalogue names .total; retain older aliases only for compatibility.
      daily = firstDay([`heating.${base}.total`, `heating.${base}.summary.total`, `heating.${base}.summary`]);
      if (!daily) {
        const heating = firstDay([`heating.${base}.summary.heating`, `heating.${base}.heating`]);
        const dhw = firstDay([`heating.${base}.summary.dhw`, `heating.${base}.dhw`]);
        const coolingNames = [`heating.${base}.summary.cooling`, `heating.${base}.cooling`];
        const hasCooling = base === 'power.consumption' && coolingNames.some(name => rawFeature(name));
        const cooling = hasCooling ? firstDay(coolingNames) : null;
        if (heating && dhw && (!hasCooling || cooling)) {
          const components = [{ scope: 'heating', ...heating }, { scope: 'dhw', ...dhw }];
          if (cooling) components.push({ scope: 'cooling', ...cooling });
          daily = { amount: heating.amount + dhw.amount + (cooling?.amount ?? 0),
            timestamp: Math.min(...components.map(item => item.timestamp)), components };
          dailyScope = hasCooling ? 'heating_dhw_cooling' : 'heating_dhw';
        }
      }
    }
    if (daily) {
      rememberTime(daily.timestamp);
      for (const component of daily.components || []) rememberTime(component.timestamp);
      metrics.today_kwh = Math.round(daily.amount * 1000) / 1000;
      metrics.today_scope = dailyScope;
      metrics.today_updated = formatTime(daily.timestamp);
      metrics.today_stale = now - daily.timestamp > settings.stale_minutes * 60000;
      if (daily.components) {
        metrics.today_components = daily.components.map(item => ({
          scope: item.scope, updated: formatTime(item.timestamp),
          stale: now - item.timestamp > settings.stale_minutes * 60000
        }));
      }
    } else {
      metrics.today_outdated = outdatedEnergy;
    }

    return metrics;
  };
  result.energy = readEnergy('power.consumption', settings.current_power_feature, settings.daily_energy_feature);
  result.heat = readEnergy('heat.production', settings.current_heat_feature, settings.daily_heat_feature);

  const pressureFeature = valid('heating.sensors.pressure.supply');
  const rawPressure = pressureFeature?.properties?.value?.value;
  const pressureUnit = pressureFeature?.properties?.value?.unit;
  const barFactors = { bar: 1, pascal: 0.00001, Pa: 0.00001, kilopascal: 0.01, kPa: 0.01,
    hectopascal: 0.001, hPa: 0.001, millibar: 0.001, mbar: 0.001 };
  const pressureFactor = barFactors[pressureUnit];
  const pressureTime = Date.parse(pressureFeature?.timestamp);
  result.pressure = {
    bar: rawPressure != null && rawPressure >= 0 && pressureFactor != null ? Math.round(rawPressure * pressureFactor * 100) / 100 : null,
    stale: Number.isFinite(pressureTime) && now - pressureTime > settings.stale_minutes * 60000,
    updated: Number.isFinite(pressureTime) ? formatTime(pressureTime) : null
  };

  if (result.pressure.bar != null) rememberTime(pressureTime);
  result.freshness.latest_reading = displayTimes.length ? formatTime(Math.max(...displayTimes)) : null;

  // E3 curve calculation used by PyViCare, with live circuit limits.
  // https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareHeatCurveCalculation.py
  let points = [];
  if (settings.curve_points) {
    try {
      const parsed = JSON.parse(settings.curve_points);
      if (Array.isArray(parsed) && parsed.length >= 2 && parsed.length <= 41 && parsed.every(point =>
        typeof point?.outdoor === 'number' && Number.isFinite(point.outdoor) && typeof point?.supply === 'number' && Number.isFinite(point.supply))) {
        points = parsed.map(point => ({ outdoor: point.outdoor, supply: point.supply })).sort((a, b) => a.outdoor - b.outdoor);
        if (new Set(points.map(point => point.outdoor)).size !== points.length) points = [];
      }
    } catch { /* Invalid reference data is flagged, never silently treated as exact. */ }
  }
  const reference = points.length > 0;
  const curveFeature = valid(`${prefix}.heating.curve`);
  const slope = curveFeature?.properties?.slope?.value;
  const shift = curveFeature?.properties?.shift?.value;
  const normalRoom = valid(`${prefix}.operating.programs.normalHeating`)?.properties?.temperature?.value
    ?? valid(`${prefix}.operating.programs.normal`)?.properties?.temperature?.value ?? null;
  const curveRoom = room ?? normalRoom;
  const limits = valid(`${prefix}.temperature.levels`)?.properties;
  const apiMax = limits?.max?.value ?? null;
  const maxSupply = apiMax ?? settings.max_supply_temperature;
  const minSupply = limits?.min?.value ?? null;
  const limitsValid = minSupply == null || maxSupply == null || minSupply <= maxSupply;
  const calculate = outdoor => {
    const delta = outdoor - curveRoom;
    let supply = curveRoom + shift - slope * delta * (1.4347 + 0.021 * delta + 0.0002479 * delta * delta);
    if (limitsValid && maxSupply != null) supply = Math.min(supply, maxSupply);
    if (limitsValid && minSupply != null) supply = Math.max(supply, minSupply);
    return supply;
  };
  if (!reference && slope != null && shift != null && curveRoom != null && limitsValid) {
    points = Array.from({ length: 51 }, (_, index) => {
      const outdoor = index - 30;
      return { outdoor, supply: calculate(outdoor) };
    }).filter(point => Number.isFinite(point.supply));
  }
  if (result.setpoints.supply == null && curveRoom != null && slope != null && shift != null && limitsValid) {
    const outdoor = value(settings.outside_feature);
    if (outdoor != null && Number.isFinite(calculate(outdoor))) {
      result.setpoints.supply = Math.round(calculate(outdoor) * 10) / 10;
      result.setpoints.supply_calculated = true;
    }
  }
  if (points.length) {
    const outdoor = value(settings.outside_feature);
    const measured = value(settings.supply_feature);
    const target = result.setpoints.supply;
    const returnTemperature = result.return_reading.value;
    const readings = [measured, target, returnTemperature].filter(number => number != null);
    const minX = Math.min(points[0].outdoor, outdoor ?? points[0].outdoor);
    const maxX = Math.max(points[points.length - 1].outdoor, outdoor ?? points[points.length - 1].outdoor);
    const minY = Math.floor((Math.min(...points.map(point => point.supply), ...readings) - 2) / 5) * 5;
    const maxY = Math.max(minY + 10, Math.ceil((Math.max(...points.map(point => point.supply), ...readings, ...(!reference && maxSupply != null ? [maxSupply] : [])) + 2) / 5) * 5);
    const round = number => Math.round(number * 10) / 10;
    const plotted = points.map(point => ({
      outdoor: point.outdoor, supply: round(point.supply),
      x: round(48 + (point.outdoor - minX) / (maxX - minX) * 386),
      y: round(156 - (point.supply - minY) / (maxY - minY) * 132),
      label: reference || point.outdoor % 10 === 0
    }));
    const marker = temperature => outdoor == null || temperature == null ? null : {
      x: round(48 + (outdoor - minX) / (maxX - minX) * 386),
      y: round(156 - (temperature - minY) / (maxY - minY) * 132)
    };
    result.curve = {
      measured: marker(measured), target: marker(target), return: marker(returnTemperature),
      reference, room_setpoint: curveRoom, max_supply: !reference && limitsValid ? maxSupply : null, max_from_api: apiMax != null,
      cap_y: !reference && maxSupply != null && limitsValid ? round(156 - (maxSupply - minY) / (maxY - minY) * 132) : null,
      invalid_reference: Boolean(settings.curve_points) && !reference,
      points: plotted, polyline: plotted.map(point => `${point.x},${point.y}`).join(' '),
      ticks: Array.from({ length: 5 }, (_, index) => ({
        value: round(minY + index * (maxY - minY) / 4), y: 156 - index * 33
      })),
      x_ticks: Array.from({ length: 6 }, (_, index) => ({ value: round(minX + index * (maxX - minX) / 5), x: 48 + index * 77.2 }))
    };
  }
  if (source.demo === true) result.demo = true;
  return result;
}
