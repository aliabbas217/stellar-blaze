import { readFileSync } from "node:fs";
import path from "node:path";
import { LOCALES, flatten } from "../../../scripts/i18n-sync.mjs";

/*
 * F2 Task 22 fix round 1 (independent review, Important 1): the Stop bar never promises WHEN a stop is delivered and never claims it
 * was (ADR 0058: the API records a stop, it alerts nobody itself). English holds this in StopWork.test.tsx (DELIVERY_CLAIM). The
 * review found "as soon as" in four machine drafts (ur, hi, bn, ne) of "sent when it is back online": an added promise. This test
 * holds every catalogue to the same rule, with a word list per language.
 *
 * Not in the lists, on purpose: "now" ("Tell the crew now" is the instruction to a person, not a delivery promise) and the one
 * allowed sentence about WHEN crews hear of a stop ("within about six minutes", ADR 0058 second entry).
 */

const MESSAGES = path.resolve(import.meta.dirname, "../../../messages");
const stopStrings = (locale: string): Map<string, string> => {
  const flat = flatten(JSON.parse(readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8")));
  return new Map([...flat].filter(([key]) => key.startsWith("supervisor.stop.")));
};

/** Words that promise speed: "immediately", "right away", "as soon as", "instantly" and their neighbours, per language. */
const IMMEDIACY: Readonly<Record<string, RegExp>> = {
  en: /immediately|right away|as soon as|instantly|at once|promptly|quickly|\bsoon\b/i,
  ar: /فور|في الحال|حالما|بمجرد|على الفور|لحظة/u,
  ur: /فور|ہوتے ہی|جیسے ہی|اسی وقت|فوراً/u,
  hi: /तुरंत|तुरन्त|फ़ौरन|फौरन|होते ही|जैसे ही|तत्काल|उसी समय/u,
  bn: /অবিলম্বে|তাৎক্ষণিক|সঙ্গে সঙ্গে|সাথে সাথে|ফেরামাত্র|যেইমাত্র|এখনই|তখনই/u,
  ne: /तुरुन्त|तुरन्त|हुनासाथ|नासाथ|तत्काल|छिट्टै|तुरुन्तै/u,
};

/** Words that claim delivery or alerting (the English list minus "notified" and "informed", which the one allowed window sentence uses). */
const DELIVERY: Readonly<Record<string, RegExp>> = {
  en: /alerted|alerting|phones|delivered|reached/i,
  ar: /تنبيه|هواتف|سُلِّم|تم التسليم|وصلت/u,
  ur: /الرٹ|فونز|فونوں|پہنچا|پہنچ گیا|ڈیلیور/u,
  hi: /अलर्ट|फ़ोनों|फोनों|पहुँच|डिलीवर/u,
  bn: /সতর্ক|ফোনগুলো|ফোনগুলি|পৌঁছ|ডেলিভারি/u,
  ne: /सतर्क|फोनहरू|पुग्|पुगे|डेलिभर/u,
};

describe.each(LOCALES)("Stop bar wording, %s: no promise of speed, no claim of delivery", (locale) => {
  const strings = stopStrings(locale);

  it("has the Stop bar strings to look at", () => {
    expect(strings.size).toBeGreaterThanOrEqual(20);
    expect(strings.size).toBe(stopStrings("en").size);
  });

  it("test_stop_copy_has_no_immediacy_word: no string under supervisor.stop says it is sent immediately or as soon as anything", () => {
    const hits = [...strings].filter(([, text]) => (IMMEDIACY[locale] as RegExp).test(text)).map(([key, text]) => `${key}: ${text}`);
    expect(hits).toEqual([]);
  });

  it("test_stop_copy_has_no_delivery_claim: no string says a crew or a phone was alerted or reached", () => {
    const hits = [...strings].filter(([, text]) => (DELIVERY[locale] as RegExp).test(text)).map(([key, text]) => `${key}: ${text}`);
    expect(hits).toEqual([]);
  });
});

describe("Stop bar wording: the detectors see what they claim to (an empty result means something)", () => {
  // The four strings the review found, word for word, and the English they translate: each list must flag them.
  it.each([
    ["ur", "<bdi>{crew}</bdi> کا حکم اس فون پر رکھا گیا ہے اور آن لائن ہوتے ہی بھیج دیا جائے گا۔"],
    ["hi", "<bdi>{crew}</bdi> का आदेश इस फ़ोन पर रखा गया है और ऑनलाइन होते ही भेज दिया जाएगा।"],
    ["bn", "<bdi>{crew}</bdi> এর নির্দেশ এই ফোনে রাখা হয়েছে এবং অনলাইনে ফেরামাত্র পাঠানো হবে।"],
    ["ne", "<bdi>{crew}</bdi> को आदेश यो फोनमा राखिएको छ र अनलाइन हुनासाथ पठाइनेछ।"],
    ["en", "The stop is kept on this phone and sent as soon as it is back online."],
    ["ar", "يُحفظ إيقاف <bdi>{crew}</bdi> على هذا الهاتف ويُرسل فور عودة الاتصال."],
  ])("flags the immediacy wording in %s", (locale, text) => {
    expect((IMMEDIACY[locale] as RegExp).test(text)).toBe(true);
  });

  it("flags a delivery claim in each language and does not flag the neutral sentence", () => {
    for (const [locale, text] of [
      ["en", "The crew's phones were alerted"],
      ["ar", "تم التسليم إلى الفريق"],
      ["ur", "ٹیم کو الرٹ بھیج دیا گیا"],
      ["hi", "टीम को अलर्ट भेज दिया गया"],
      ["bn", "দলকে সতর্ক করা হয়েছে"],
      ["ne", "समूहलाई सतर्क गरियो"],
    ] as const)
      expect((DELIVERY[locale] as RegExp).test(text), locale).toBe(true);
    expect((IMMEDIACY["en"] as RegExp).test("Tell the crew now.")).toBe(false);
  });
});
