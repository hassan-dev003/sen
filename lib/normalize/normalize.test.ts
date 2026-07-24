import { describe, expect, it } from "vitest";
import { normalize, NORMALIZER_VERSION } from "./index";

describe("rail extraction", () => {
  it("pulls a known rail prefix into the structured field", () => {
    expect(normalize("MAE QR SARAH RISHAD HAMID * 255626498Q").rail).toBe("MAE QR");
    expect(normalize("PAYMENT VIA MYDEBIT ECO MART KINRARA").rail).toBe(
      "PAYMENT VIA MYDEBIT",
    );
    expect(normalize("PYMT VIA MYDEBIT RE APSB.MX.COVA*").rail).toBe(
      "PYMT VIA MYDEBIT RE",
    );
  });

  it("normalises a trailing hyphen or star on the rail away", () => {
    expect(normalize("DUITNOW QR- MIXUE * QR71429243").rail).toBe("DUITNOW QR");
    expect(normalize("REV PREAUTH MYDEBIT* SHELL SUNWAY").rail).toBe(
      "REV PREAUTH MYDEBIT",
    );
  });

  it("prefers the longer rail when one is a prefix of another", () => {
    expect(normalize("PRE-AUTH MYDEBIT PETRON").rail).toBe("PRE-AUTH MYDEBIT");
    expect(normalize("PRE-AUTH DEBIT DIGITALOCEAN.COM").rail).toBe("PRE-AUTH DEBIT");
  });

  it("leaves rail null when none is recognised", () => {
    expect(normalize("SOME UNKNOWN THING").rail).toBeNull();
  });
});

describe("merchant extraction", () => {
  it("takes the merchant between rail and reference", () => {
    const n = normalize("MAE QR SARAH RISHAD HAMID * 255626498Q");
    expect(n.merchant).toBe("SARAH RISHAD HAMID");
    expect(n.descriptionNormalized).toBe("SARAH RISHAD HAMID");
    expect(n.merchantTruncated).toBe(false);
  });

  it("keeps a hyphen and records truncation", () => {
    const n = normalize("DUITNOW QR LCSB - Genting Semp* QR71429243");
    expect(n.merchant).toBe("LCSB - GENTING SEMP");
    expect(n.merchantTruncated).toBe(true);
  });

  it("keeps a star embedded inside the name, strips only the trailing one", () => {
    const n = normalize("PAYMENT VIA MYDEBIT MPY*GCE-BKT JELUTON* 126641398Q");
    expect(n.merchant).toBe("MPY*GCE-BKT JELUTON");
    expect(n.merchantTruncated).toBe(true);
  });

  it("drops a reference that leads the merchant (FPX shape)", () => {
    const n = normalize(
      "FPX PAYMENT FR A/ my3260024837 MAJLIS BANDARAYA SHA 2605251939230384",
    );
    expect(n.rail).toBe("FPX PAYMENT FR A/");
    expect(n.merchant).toBe("MAJLIS BANDARAYA SHA");
  });
});

describe("reference tokens", () => {
  it("removes every observed reference form", () => {
    expect(normalize("MAE QR CAFE X QR71429243").merchant).toBe("CAFE X");
    expect(normalize("MAE QR CAFE X 126641398Q").merchant).toBe("CAFE X");
    expect(normalize("MAE QR CAFE X 11113411886488").merchant).toBe("CAFE X");
    expect(normalize("MAE QR CAFE X T110296493826").merchant).toBe("CAFE X");
    expect(normalize("MAE QR CAFE X my3260024837").merchant).toBe("CAFE X");
  });

  it("leaves no merchant when only a QR reference remains", () => {
    const n = normalize("DUITNOW QR QR75812013");
    expect(n.merchant).toBeNull();
    expect(n.descriptionNormalized).toBe("");
  });

  it("keeps a bare phone number as the merchant, does not strip it", () => {
    const n = normalize("DUITNOW QR 12025551234");
    expect(n.merchant).toBe("12025551234");
  });
});

describe("payroll month suffix", () => {
  it("strips the MMYY period so the rule matches every month", () => {
    expect(normalize("SVG GIRO CR ACME CORP SALARY 0426").merchant).toBe(
      "ACME CORP SALARY",
    );
    expect(normalize("SVG GIRO CR ACME CORP SALARY 0526").merchant).toBe(
      "ACME CORP SALARY",
    );
  });
});

describe("cross-source convergence", () => {
  it("produces the same merchant regardless of which rail carried it", () => {
    const viaHistory = normalize("MAE QR MIXUE MID VALLEY QR71429243");
    const viaOther = normalize("DUITNOW QR MIXUE MID VALLEY 126641398Q");
    expect(viaHistory.merchant).toBe(viaOther.merchant);
    expect(viaHistory.merchant).toBe("MIXUE MID VALLEY");
  });
});

describe("versioning", () => {
  it("exposes a numeric normalizer version", () => {
    expect(NORMALIZER_VERSION).toBe(1);
  });
});
