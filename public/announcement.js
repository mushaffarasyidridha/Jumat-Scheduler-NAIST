// The weekly Jumat announcement (the broadcast posted in the WhatsApp and
// Facebook groups). One copy, used by the page's "Generate announcement"
// button and by the calendar events, whose description is this same text.
//
// A plain script - no import/export - so the page can load it with a <script>
// tag (after reminder-message.js); Node and the Pages Functions load the very
// same file through require() / import.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./reminder-message.js"));
  else root.JumatAnnouncement = factory(root.JumatReminderMessage);
})(typeof self !== "undefined" ? self : this, function (reminder) {
  "use strict";

  // Each entry verified against sunnah.com/dorar.net references (English +
  // Arabic cross-checked, not generated from memory alone) - reference and
  // in-book numbering match the citation style already used for these
  // collections. Kept small and fully verified rather than large and guessed.
  const HADITHS = [
    {
      reference: "Sahih Muslim 851a",
      inBook: "Book 7, Hadith 15",
      intro: "Abu Huraira reported Allah's Messenger (ﷺ) as saying:",
      english: "If you (even) ask your companion to be quiet on Friday while the Imam is delivering the sermon, you have in fact talked irrelevance.",
      arabic: "إذا قلت لصاحبك أنصت يوم الجمعة والإمام يخطب فقد لغوت",
    },
    {
      reference: "Sahih al-Bukhari 879",
      inBook: "Book 11, Hadith 4",
      intro: "Narrated Abu Sa'id al-Khudri: Allah's Messenger (ﷺ) said:",
      english: "Taking a bath on Friday is compulsory for every Muslim who has attained the age of puberty, and also the cleaning of his teeth with Siwak, and the using of perfume if it is available.",
      arabic: "الغسل يوم الجمعة واجب على كل محتلم، وأن يستن، وأن يمس طيبًا إن وجد",
    },
    {
      reference: "Sahih al-Bukhari 881",
      inBook: "Book 11, Hadith 6",
      intro: "Narrated Abu Huraira: Allah's Messenger (ﷺ) said:",
      english: "Whoever takes a bath on Friday like the bath of Janaba and then goes for the prayer in the first hour, it is as if he had sacrificed a camel; whoever goes in the second hour, it is as if he had sacrificed a cow; whoever goes in the third hour, then it is as if he had sacrificed a horned ram; whoever goes in the fourth hour, then it is as if he had sacrificed a hen; and whoever goes in the fifth hour, then it is as if he had offered an egg.",
      arabic: "من اغتسل يوم الجمعة غسل الجنابة ثم راح في الساعة الأولى فكأنما قرب بدنة، ومن راح في الساعة الثانية فكأنما قرب بقرة، ومن راح في الساعة الثالثة فكأنما قرب كبشًا أقرن، ومن راح في الساعة الرابعة فكأنما قرب دجاجة، ومن راح في الساعة الخامسة فكأنما قرب بيضة",
    },
    {
      reference: "Sahih al-Bukhari 935",
      inBook: "Book 11, Hadith 59",
      intro: "Narrated Abu Huraira: Allah's Messenger (ﷺ) mentioned Friday and said:",
      english: "There is an hour on Friday, and if a Muslim slave happens to pray at that time and asks Allah for something good, Allah will give it to him. (He pointed with his hand to indicate how short that time is.)",
      arabic: "فيه ساعة لا يوافقها عبد مسلم وهو قائم يصلي يسأل الله تعالى شيئًا إلا أعطاه إياه",
    },
    {
      reference: "Sahih Muslim 854b",
      inBook: "Book 7, Hadith 27",
      intro: "Abu Huraira reported Allah's Messenger (ﷺ) as saying:",
      english: "The best day on which the sun has risen is Friday; on it Adam was created, on it he was made to enter Paradise, on it he was expelled from it, and the Last Hour will take place on no day other than Friday.",
      arabic: "خير يوم طلعت عليه الشمس يوم الجمعة، فيه خلق آدم، وفيه أدخل الجنة، وفيه أخرج منها، ولا تقوم الساعة إلا في يوم الجمعة",
    },
  ];

  // The page picks one at random (with a "another hadith" button). A calendar
  // event must not change between two fetches, so it gets one chosen from the
  // date instead: a new one each week, the same one every time that week.
  function randomHadith() {
    return HADITHS[Math.floor(Math.random() * HADITHS.length)];
  }

  function hadithForDate(iso) {
    const week = Math.floor(Date.parse(iso + "T00:00:00Z") / (7 * 24 * 60 * 60 * 1000));
    return HADITHS[week % HADITHS.length];
  }

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Fixed "D Month YYYY" order rather than toLocaleDateString, whose field
  // order depends on the viewer's locale (would show US-style
  // "September 25, 2026" for some visitors).
  function formatDateAnnouncement(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  function khatibLine(friday) {
    const p = friday.primary_name;
    const s = friday.secondary_name;
    if (p && s) return `${p} / ${s} (Secondary)`;
    if (p) return p;
    if (s) return `${s} (Secondary)`;
    return "TBA";
  }

  // Map links only for venues we actually have one for - never guessed for
  // the others (the venue is free text and changes week to week).
  const VENUE_MAP_LINKS = {
    "assembly room - sentan": "https://maps.app.goo.gl/Dd44PcXYVqFm7KDA6",
  };

  function venueLine(friday) {
    const venue = (friday.venue || "").trim();
    if (!venue) return "Friday Prayer will be held in sha Allah (venue to be announced).";
    const link = VENUE_MAP_LINKS[venue.toLowerCase()];
    return `Friday Prayer will be held in sha Allah at ${venue}${link ? ` (${link})` : ""}.`;
  }

  function buildAnnouncementText(friday, hadith) {
    return `Assalamualaikum Warrahmatullah Wabarakatuh,
Dear Brothers,

${venueLine(friday)}
Date: ${formatDateAnnouncement(friday.date)}
Time: ${reminder.PRAYER_TIME}
Khatib: ${khatibLine(friday)}
Imam: ${friday.imam_name || "TBA"}

To uphold cleanliness and hygiene in our prayer space, we kindly ask all brothers to bring their own prayer mats. We appreciate your cooperation.

${hadith.reference} (${hadith.inBook})

${hadith.intro}

${hadith.english}

${hadith.arabic}`;
  }

  return {
    HADITHS,
    randomHadith,
    hadithForDate,
    formatDateAnnouncement,
    khatibLine,
    venueLine,
    buildAnnouncementText,
  };
});
