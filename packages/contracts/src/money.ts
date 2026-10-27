/** Money has at most 10 whole digits and 2 decimals, matching the database's Decimal(12,2). */
export const MONEY_FORMAT = /^-?\d{1,10}(\.\d{1,2})?$/;
