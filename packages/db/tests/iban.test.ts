import { describe, expect, it } from "vitest";
import { formatAccountNumber, isValidBic, isValidIban, looksLikeIban } from "../src/iban";

describe("IBAN", () => {
  it("accepte des IBAN valides (exemples publics de la norme)", () => {
    expect(isValidIban("FR14 2004 1010 0505 0001 3M02 606")).toBe(true);
    expect(isValidIban("GB82WEST12345698765432")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
  });
  it("refuse une faute de frappe", () => {
    expect(isValidIban("FR14 2004 1010 0505 0001 3M02 607")).toBe(false);
    expect(isValidIban("FR14")).toBe(false);
  });
  it("distingue un IBAN d'un numéro de compte national", () => {
    expect(looksLikeIban("FR1420041010050500013M02606")).toBe(true);
    expect(looksLikeIban("0123456789")).toBe(false);
  });
  it("met en forme par groupes de 4", () => {
    expect(formatAccountNumber("fr1420041010050500013m02606")).toBe("FR14 2004 1010 0505 0001 3M02 606");
    expect(formatAccountNumber("0123456789")).toBe("0123456789");
  });
  it("valide un BIC", () => {
    expect(isValidBic("BNPAFRPP")).toBe(true);
    expect(isValidBic("BNPAFRPPXXX")).toBe(true);
    expect(isValidBic("12")).toBe(false);
  });
});
