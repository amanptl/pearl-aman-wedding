// Everything guests see comes from this file. Edit freely.
window.WEDDING = {
  couple: { first: "Pearl", second: "Aman" },
  initials: "P A",

  // ISO date-time in the venue's local time; drives the countdown.
  date: "2027-07-25T16:00:00",
  dateText: "July 25th, 2027",
  timeText: "at 4 o'clock",

  venue: {
    name: "[Venue Name] Estate",
    lines: ["[Venue Name] Estate,", "[City],", "[Province] [Postal Code]"],
    mapUrl: "https://maps.google.com/?q=Venue+Name",
  },

  // Paste your Google Apps Script web-app URL here (see SETUP.md).
  // Leave empty to run the form in demo mode.
  rsvpEndpoint: "",

  // Public URL of the published site; used by the QR code page.
  siteUrl: "",

  // Photo that slides out of the envelope on the home page.
  homePhoto: "assets/couple-1.jpg",

  cards: [
    {
      icon: "assets/icon-location.jpg",
      title: "Location",
      text: "Our wedding will be held at [Venue Name] Estate, [City], [Province].",
      link: { label: "View address", url: "https://maps.google.com/?q=Venue+Name" },
    },
    {
      icon: "assets/icon-date.jpg",
      title: "Date",
      text: "Join us on July 25, 2027, as we celebrate with the people we love most.",
    },
    {
      icon: "assets/icon-ceremony.jpg",
      title: "Ceremony",
      text: "The ceremony begins at 4 o'clock on the garden lawn of [Venue Name] Estate.",
    },
    {
      icon: "assets/icon-reception.jpg",
      title: "Reception",
      text: "Stay with us for dinner, drinks and dancing in the [Grand Hall] that evening.",
    },
  ],

  schedule: [
    { time: "3:30 PM", title: "Arrival & Welcome" },
    { time: "4:00 PM", title: "Ceremony" },
    { time: "5:00 PM", title: "Cocktail Hour" },
    { time: "6:30 PM", title: "Dinner" },
    { time: "8:00 PM", title: "First Dance" },
    { time: "11:30 PM", title: "Farewell" },
  ],

  accommodation: [
    {
      name: "[Hotel One]",
      text: "A short drive from the venue, with garden views and a room block reserved under \"Pearl & Aman\".",
      url: "https://maps.google.com/?q=Hotel+One",
    },
    {
      name: "[Hotel Two]",
      text: "A charming inn in [Town], about fifteen minutes away. Mention our wedding when booking.",
      url: "https://maps.google.com/?q=Hotel+Two",
    },
  ],

  registry: {
    photo: "assets/couple-2.jpg",
    paragraphs: [
      "Having you there to celebrate with us is the greatest gift of all.",
      "For those who have asked, we've put together a small registry, and a contribution toward our first home together would be warmly appreciated.",
      "Thank you for your love and support.",
    ],
    url: "#",
  },

  dressCode: {
    text: "We'd love for you to join us in elegant formal attire that suits an evening at the estate.",
    swatches: ["#4a3f28", "#7d7b4a", "#7a3238", "#4b1c22"],
    notes: [
      { who: "Gentlemen", text: "Dark suits or tuxedos with classic dress shoes." },
      { who: "Ladies", text: "Floor-length or midi gowns in rich, refined tones." },
    ],
  },

  story: {
    teaser: "Every love story is beautiful, but ours is our favourite.",
    teaserBackground: "assets/gallery-venue.jpg",
    photos: ["assets/couple-1.jpg", "assets/couple-3.jpg"],
    paragraphs: [
      "Every love story is beautiful, but ours is our favourite.",
      "[How you met — a few sentences about the first time Pearl and Aman crossed paths.]",
      "[The moments in between — trips, inside jokes, the little things that made it feel like home.]",
      "[The proposal — where, when, and who cried first.]",
      "Thank you for being part of our story. We can't wait to celebrate the next chapter with you.",
    ],
  },

  faq: [
    { q: "What time should I arrive?", a: "Please arrive by 3:30 PM so you have time to find your seat before the ceremony begins at 4:00." },
    { q: "Can I bring a plus-one or children?", a: "We're keeping the day intimate, so we can only accommodate the guests named on your invitation. Thank you for understanding." },
    { q: "Where should I park?", a: "Complimentary parking is available on site at [Venue Name] Estate. Accessible parking is located beside the main entrance." },
    { q: "Is transportation provided?", a: "[A shuttle will run between the recommended hotels and the venue before the ceremony and after the reception.]" },
    { q: "Is the event indoors or outdoors?", a: "The ceremony will be outdoors on the lawn (weather permitting) and the reception will be indoors." },
  ],

  rsvp: {
    intro: ["We'd love for you to be part of our celebration!", "Kindly fill out the form below to let us know if you can make it."],
    deadline: "June 1st, 2027",
    mealOptions: ["Beef tenderloin", "Herb-roasted chicken", "Wild mushroom risotto (vegetarian)"],
  },
};
