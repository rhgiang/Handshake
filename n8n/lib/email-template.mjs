/** Shared Handshake transactional email shell (Stripe/Linear-style: whitespace, one CTA, muted footer). */
export const htmlExpr = (setup, parts) => {
  const js = parts.map((p) => (typeof p === 'string' ? JSON.stringify(p) : `String(${p.v})`)).join(' + ');
  return `={{ (() => { ${setup}; return ${js}; })() }}`;
};

const css = {
  bg: '#f4f7f9',
  card: '#ffffff',
  ink: '#0b1f33',
  muted: '#5b6b7c',
  line: '#d7e0e8',
  accent: '#0f766e',
  accentSoft: '#e6f4f2',
  font: "Inter,Segoe UI,Roboto,Helvetica Neue,Arial,sans-serif",
};

/** Static open/close chrome; insert dynamic middle via parts. */
export function shellParts({ preheader, eyebrow, ctaLabel, footerNote }) {
  const open = [
    "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'>",
    `<title>Handshake</title></head><body style='margin:0;padding:0;background:${css.bg};font-family:${css.font};color:${css.ink}'>`,
    `<div style='display:none;max-height:0;overflow:hidden;opacity:0;color:transparent'>${preheader}</div>`,
    `<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='background:${css.bg};padding:40px 16px'><tr><td align='center'>`,
    `<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='max-width:560px;background:${css.card};border:1px solid ${css.line};border-radius:16px;overflow:hidden'>`,
    `<tr><td style='height:4px;background:${css.accent};font-size:0;line-height:0'>&nbsp;</td></tr>`,
    `<tr><td style='padding:28px 32px 8px'><p style='margin:0;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${css.accent}'>Handshake</p>`,
    eyebrow
      ? `<p style='margin:10px 0 0;font-size:13px;color:${css.muted}'>${eyebrow}</p>`
      : '',
    `<h1 style='margin:14px 0 0;font-size:28px;line-height:1.25;font-weight:650;letter-spacing:-0.02em;color:${css.ink}'>`,
  ].join('');

  const afterTitle = `</h1>`;
  const bodyOpen = `<div style='margin:18px 0 0;font-size:16px;line-height:1.6;color:${css.ink}'>`;
  const bodyClose = `</div>`;
  const cta = (hrefVar) => [
    `<p style='margin:28px 0 0'><a href='`,
    { v: hrefVar },
    `' style='display:inline-block;background:${css.accent};color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-size:15px;font-weight:600'>${ctaLabel}</a></p>`,
  ];
  const footer = (stopVar, stopLabel) => [
    `<hr style='border:none;border-top:1px solid ${css.line};margin:32px 0 18px'>`,
    `<p style='margin:0;font-size:13px;line-height:1.55;color:${css.muted}'>${footerNote}</p>`,
    `<p style='margin:14px 0 0;font-size:12px;line-height:1.5;color:${css.muted}'><a href='`,
    { v: stopVar },
    `' style='color:${css.muted};text-decoration:underline'>${stopLabel}</a></p>`,
    `</td></tr></table>`,
    `<p style='margin:18px 0 0;font-size:11px;line-height:1.4;color:${css.muted};font-family:${css.font}'>Handshake · practice reminders</p>`,
    `</td></tr></table></body></html>`,
  ];
  const detailCard = (innerParts) => [
    `<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='margin:22px 0 0;background:${css.accentSoft};border-radius:12px'><tr><td style='padding:16px 18px'>`,
    ...innerParts,
    `</td></tr></table>`,
  ];

  return { open, afterTitle, bodyOpen, bodyClose, cta, footer, detailCard, css };
}

/** Opt-in: allow practice reminder emails; opt out anytime after confirming. */
export function confirmEmailHtml(kind = "contact") {
  const { open, afterTitle, bodyOpen, bodyClose, cta, css: c } = shellParts({
    preheader: 'Confirm to get Handshake practice reminders. You can opt out anytime.',
    eyebrow: 'Permission needed',
    ctaLabel: 'Allow practice reminders',
    footerNote: '',
  });
  const setup = `const url=$vars.HANDSHAKE_LINK_ORIGIN+'/webhook/${kind === "learner" ? "handshake-learner-confirm" : "handshake-confirm"}?token='+${kind === "learner" ? "$('Persist subscription').first().json.result.learnerToken" : "$json.result.token"}`;
  return htmlExpr(setup, [
    open,
    'Allow practice reminders?',
    afterTitle,
    bodyOpen,
    kind === "learner" ? "<p style='margin:0 0 12px'>Confirm your email to receive weekly ASL practice recaps from Handshake.</p>" : "<p style='margin:0 0 12px'>Someone entered your email to receive updates when they complete ASL lessons on Handshake.</p>",
    "<p style='margin:0 0 12px'>Confirm only if you want those reminders. You can opt out anytime from any email we send.</p>",
    "<p style='margin:0'>If this was unexpected, ignore this message and you will get nothing.</p>",
    bodyClose,
    ...cta('url'),
    { v: kind === 'contact' ? "($json.result.learnerIncluded ? '<p>For your own weekly recaps, separately confirm: <a href=\"'+$vars.HANDSHAKE_LINK_ORIGIN+'/webhook/handshake-learner-confirm?token='+$json.result.learnerToken+'\">Confirm weekly recaps</a></p>' : '')" : "''" },
    `<hr style='border:none;border-top:1px solid ${c.line};margin:32px 0 18px'>`,
    `<p style='margin:0;font-size:13px;line-height:1.55;color:${c.muted}'>No confirmation = no emails. Opt out anytime after you confirm.</p>`,
    `</td></tr></table>`,
    `<p style='margin:18px 0 0;font-size:11px;line-height:1.4;color:${c.muted};font-family:${c.font}'>Handshake · practice reminders</p>`,
    `</td></tr></table></body></html>`,
  ]);
}

/** Lesson completion update for a confirmed contact. */
export function lessonEmailHtml() {
  const { open, afterTitle, bodyOpen, bodyClose, footer } = shellParts({
    preheader: 'An ASL lesson completed on Handshake.',
    eyebrow: 'Lesson completed',
    ctaLabel: 'Open Handshake',
    footerNote: 'You can opt out anytime.',
  });
  const setup =
    "const title=$('Claim lesson').item.json.result.title; const stop=$vars.HANDSHAKE_LINK_ORIGIN+'/webhook/handshake-unsubscribe?token='+encodeURIComponent($json.result.unsubscribeToken)";
  return htmlExpr(setup, [
    open,
    { v: 'title' },
    afterTitle,
    bodyOpen,
    "<p style='margin:0'>Someone you support completed this ASL lesson on Handshake. Thank you for being part of their learning journey.</p>",
    bodyClose,
    ...footer('stop', 'Opt out of lesson updates'),
  ]);
}

/** Duolingo-style nudge: get back into practice + light stats + opt out. */
export function recapEmailHtml() {
  const { open, afterTitle, bodyOpen, bodyClose, detailCard, footer, css: c } = shellParts({
    preheader: 'Time to get back into ASL practice on Handshake.',
    eyebrow: 'Practice reminder',
    ctaLabel: 'Open Handshake',
    footerNote: 'You opted in to practice reminders. You can opt out anytime.',
  });
  const setup =
    "const attempts=$('Weighted stats').item.json.result.attempts; const share=$('Weighted stats').item.json.result.share; const summary=share===null?'No attempts recorded yet — a short session still counts.':('Reference match share: '+share+'%.'); const stop=$vars.HANDSHAKE_LINK_ORIGIN+'/webhook/handshake-learner-unsubscribe?token='+encodeURIComponent($json.result.unsubscribeToken)";
  return htmlExpr(setup, [
    open,
    'Ready for another ASL session?',
    afterTitle,
    bodyOpen,
    "<p style='margin:0 0 12px'>A little practice goes a long way. Jump back into Handshake when you have a few minutes.</p>",
    "<p style='margin:0'>Here is how the last couple of weeks looked:</p>",
    bodyClose,
    ...detailCard([
      `<table role='presentation' width='100%' cellspacing='0' cellpadding='0'><tr>`,
      `<td style='padding:0 8px 0 0;width:50%'><p style='margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${c.accent}'>Attempts</p><p style='margin:8px 0 0;font-size:28px;font-weight:700;line-height:1;color:${c.ink}'>`,
      { v: 'attempts' },
      `</p></td>`,
      `<td style='padding:0 0 0 8px;width:50%'><p style='margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${c.accent}'>Progress</p><p style='margin:8px 0 0;font-size:16px;font-weight:650;line-height:1.35;color:${c.ink}'>`,
      { v: 'summary' },
      `</p></td></tr></table>`,
    ]),
    `<p style='margin:28px 0 0;font-size:15px;line-height:1.5;color:${c.ink}'><strong>Open Handshake</strong> and pick up where you left off.</p>`,
    ...footer('stop', 'Opt out of all practice emails'),
  ]);
}
