/** The deck: what a model can deal, how a card becomes a widget, where it lands. */
export { CATALOG, CARD_IDS, cardSize, footprint, getCard } from "./catalog.ts";
export type { Card, CardContext, CardId, DealtCard } from "./catalog.ts";
export { applyCard, checkCard } from "./apply.ts";
export type { Applied, CardCheck } from "./apply.ts";
export { placeCards, placeReason, stackParts } from "./place.ts";
export type { PlaceRoom, Placement, Rect } from "./place.ts";
export { catalogJson, dealTurn, deckPrompt, parseDeal, roomContext } from "./prompt.ts";
export type { Deal, DealItem } from "./prompt.ts";
export { guessCard, parsePartialCard, sentenceHangs, skeletonWidget, titleFromWords } from "./guess.ts";
export {
  BOARD_LETTERS, cardLine, dealTurnV2, deckPromptV2, decideMessages, DECIDE_CHOICES, DECIDE_LETTERS, parseDealResolved, routeAsk, scrubTokens, tokenMenu,
} from "./promptV2.ts";
export type { AskRoute, ResolvedItem } from "./promptV2.ts";
export { resolveCard } from "./resolve.ts";
export type { Resolved, ResolveNote, RoomFacts } from "./resolve.ts";
export { boardItems, existingFor, titleOfWidget } from "./existing.ts";
export type { BoardItem, ExistingCheck } from "./existing.ts";
