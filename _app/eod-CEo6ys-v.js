const e=`{
  "id": "eod-fixture",
  "title": "Evening check-in (fixture)",
  "intro": "Fixture questionnaire. Answer quickly.",
  "pages": [
    { "items": [
      { "id": "bii_1", "type": "likert", "text": "[Placeholder item 1]", "scale": { "min": 1, "max": 5, "minLabel": "Strongly disagree", "maxLabel": "Strongly agree" } },
      { "id": "bii_2", "type": "likert", "text": "[Placeholder item 2]", "scale": { "min": 1, "max": 5, "minLabel": "Strongly disagree", "maxLabel": "Strongly agree" } }
    ] },
    { "items": [
      { "id": "mood", "type": "choice", "text": "How was today?", "options": ["Good", "Okay", "Hard"] },
      { "id": "note", "type": "text", "text": "Anything else?" }
    ] }
  ]
}
`;export{e as default};
