import { describe, expect, it } from "vitest";
import { countryName, parseTicketNumber, ticketNumber } from "../src/format";

describe("numéro de billet", () => {
  it("combine la date de l'événement et le numéro séquentiel", () => {
    expect(ticketNumber(45, new Date("2026-12-06T19:00:00Z"))).toBe("EV202612060045");
    expect(ticketNumber(12345, new Date("2026-12-06T19:00:00Z"))).toBe("EV2026120612345");
  });
  it("utilise la date de Paris (un événement à 23h30 reste ce jour-là)", () => {
    expect(ticketNumber(1, new Date("2026-12-06T22:30:00Z"))).toBe("EV202612060001");
    expect(ticketNumber(1, new Date("2026-12-06T23:30:00Z"))).toBe("EV202612070001"); // 00h30 le 7 à Paris
  });
  it("retrouve le numéro séquentiel depuis la saisie", () => {
    expect(parseTicketNumber("EV202612060045")).toBe(45);
    expect(parseTicketNumber(" ev 2026 1206 0045 ")).toBe(45);
    expect(parseTicketNumber("EV2026120612345")).toBe(12345);
    expect(parseTicketNumber("abc")).toBeNull();
  });
  it("donne le nom du pays en français", () => {
    expect(countryName("BJ")).toBe("Bénin");
    expect(countryName("fr")).toBe("France");
  });
});
