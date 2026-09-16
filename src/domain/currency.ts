/**
 * `UAH` plus every fiat currency the NBU API quotes (`bank.gov.ua/NBU_Exchange`,
 * live feed checked while adding this: 40 codes). Shared by accounts,
 * transactions, and `GET /fx-rates/:currency/latest` — one currency concept,
 * not a separate allow-list per feature (see `openapi/openapi.yaml`'s
 * `Currency` schema, which mirrors this list exactly).
 *
 * NBU also quotes `XAU/XAG/XPT/XPD` (banking metals) and `XDR` (IMF SDR, not a
 * national currency) through the same endpoint — deliberately left out here;
 * fiat only for now.
 */
export enum Currency {
  UAH = 'UAH',
  AED = 'AED',
  AUD = 'AUD',
  AZN = 'AZN',
  BDT = 'BDT',
  CAD = 'CAD',
  CHF = 'CHF',
  CNY = 'CNY',
  CZK = 'CZK',
  DKK = 'DKK',
  DZD = 'DZD',
  EGP = 'EGP',
  EUR = 'EUR',
  GBP = 'GBP',
  GEL = 'GEL',
  HKD = 'HKD',
  HUF = 'HUF',
  IDR = 'IDR',
  ILS = 'ILS',
  INR = 'INR',
  JPY = 'JPY',
  KRW = 'KRW',
  KZT = 'KZT',
  LBP = 'LBP',
  MDL = 'MDL',
  MXN = 'MXN',
  MYR = 'MYR',
  NOK = 'NOK',
  NZD = 'NZD',
  PLN = 'PLN',
  RON = 'RON',
  RSD = 'RSD',
  SAR = 'SAR',
  SEK = 'SEK',
  SGD = 'SGD',
  THB = 'THB',
  TND = 'TND',
  TRY = 'TRY',
  USD = 'USD',
  VND = 'VND',
  ZAR = 'ZAR',
}
