import type { AssembledForm } from "@/lib/assembly";
import katex from "katex";

const letters = ["A", "B", "C", "D", "E"];

function math(text: string) {
  return text.replace(/\$([^$]+)\$/g, (_, expression) => katex.renderToString(expression, { throwOnError: false }));
}

export function formHtml(title: string, form: AssembledForm, answerKey = false) {
  const items = form.items.map((item, index) => {
    const options = item.optionOrder.map((optionIndex, choiceIndex) => {
      const isCorrect = item.correctLetters.includes(letters[choiceIndex]);
      return `<li class="choice ${answerKey && isCorrect ? "correct" : ""}"><span class="bubble">${letters[choiceIndex]}</span>${math(item.options[optionIndex])}${answerKey && isCorrect ? " <strong>Correct</strong>" : ""}</li>`;
    }).join("");
    const answer = answerKey ? `<p class="key-note">Answer: ${item.correctLetters.join(", ")}${item.variant ? ` (${item.variant.correct})` : ""}</p>` : "";
    return `<article><h3>${index + 1}. ${math(item.id)}</h3><ol>${options}</ol>${answer}</article>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:letter;margin:.55in}body{font:11pt Arial;color:#111}header,footer{display:flex;justify-content:space-between;border-bottom:1px solid #222;padding-bottom:8px}footer{border-top:1px solid #222;border-bottom:0;margin-top:16px;padding-top:8px;font-size:9pt}article{break-inside:avoid;margin:16px 0}h3{font-size:11pt;font-weight:600}ol{list-style:none;padding:0}.choice{display:flex;align-items:center;gap:8px;margin:7px 0}.bubble{width:18px;height:18px;border:1.5px solid #111;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8pt}.correct .bubble{background:#111;color:white}.key-note{font-size:9pt;color:#333}.katex{font-size:1em}</style></head><body><header><strong>${title}${answerKey ? " Answer Key" : ""}</strong><span>Form ID: ${form.code}</span></header>${items}<footer><span>FormForge</span><span>Form ID: ${form.code}</span></footer></body></html>`;
}
