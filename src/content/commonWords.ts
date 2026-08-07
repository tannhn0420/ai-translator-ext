// ============================================
// A compact set of common English words (roughly the most frequent ~600).
// Used by the "highlight hard words" feature: a content word that is NOT in this
// set (after light lemmatisation) is treated as potentially unfamiliar. Short
// function words are excluded by a minimum-length gate, so this list focuses on
// getting the frequent MEDIUM/LONG words right (those are what would otherwise be
// false-positives). Not exhaustive — good enough as a heuristic.
// ============================================

const WORDS = `
the be to of and a in that have i it for not on with he as you do at this but his by from they we
say her she or an will my one all would there their what so up out if about who get which go me when
make can like time no just him know take people into year your good some could them see other than
then now look only come its over think also back after use two how our work first well way even new
want because any these give day most us man woman child life world school state family student group
country problem hand part place case week company system program question government number night point
home water room mother area money story fact month lot right study book eye job word business issue side
kind head house service friend father power hour game line end member law car city community name president
team minute idea body information back parent face others level office door health person art war history
party result change morning reason research girl guy moment air teacher force education foot boy age policy
process music market sense nation plan college interest death experience effect use class control care field
development role effort rule attention practice human month history story example society though thing
often really almost example enough always across become between during before through under against within
around without behind beyond therefore however although perhaps together already another sometimes usually
different important possible available national international political economic social physical medical
personal special general natural popular similar particular various serious certain modern common recent
private public local current global federal simple single specific standard financial cultural digital
understand remember consider continue provide include increase decrease develop happen believe suggest
require produce receive explain describe achieve improve prepare compare create manage perform involve remain
appear allow follow expect decide contain support reduce reflect discuss identify indicate maintain
represent establish determine recognize introduce experience position situation activity community industry
economy company product project service customer market business decision management department knowledge
technology environment relationship performance opportunity information communication organization
population generation government education attention condition direction discussion connection collection
description operation production application traditional professional individual particular successful
necessary difficult beautiful wonderful available responsible comfortable interesting significant
`;

export const COMMON_WORDS = new Set(WORDS.trim().split(/\s+/).map((w) => w.toLowerCase()));

/** Light stemming so "walked/walking/walks/cities" match "walk/city" in the common set. */
export function lemma(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ied') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** True if the word is common (itself or its lemma is in the set). */
export function isCommon(word: string): boolean {
  const w = word.toLowerCase();
  return COMMON_WORDS.has(w) || COMMON_WORDS.has(lemma(w));
}
