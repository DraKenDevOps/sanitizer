/**
 * Caja HTML sanitizer.
 *
 * Ported from sanitizer.js (Caja HTML Sanitizer, Apache-2.0).
 */

import html4 from './html4';
import URI from './uri';

if ('I'.toLowerCase() !== 'i') { throw 'I/i problem'; }

/** Alternating attribute names and values, as used by the SAX handlers. */
export type AttributeList = Array<string | null>;

/** Record returned by a tag policy, or null/undefined to drop the element. */
export interface TagPolicyDecision {
    attribs: AttributeList;
    tagName?: string;
}

export type TagPolicy = (
    tagName: string,
    attribs: AttributeList
) => TagPolicyDecision | null | undefined;

/** Transforms URI attributes; null deletes the attribute. */
export type NaiveUriRewriter = (
    uri: URI,
    effect: number | undefined,
    ltype: number | undefined,
    hints: Record<string, string>
) => { toString(): string } | null | undefined;

/** Transforms attributes containing HTML names, IDs and class lists. */
export type NmTokenPolicy = (value: string) => string | null;

export interface LogDetails {
    change?: 'removed' | 'changed' | 'added';
    tagName?: string;
    attribName?: string;
    oldValue?: string | null;
    newValue?: string | null;
}

export type SanitizerLogger = (message: string, details: LogDetails) => void;

export interface SaxHandler<P = unknown> {
    startDoc?: (param: P) => void;
    endDoc?: (param: P) => void;
    startTag?: (
        name: string,
        attribs: AttributeList,
        param: P,
        continuationMarker: object,
        continuation: () => void
    ) => void;
    endTag?: (
        name: string,
        param: P,
        continuationMarker: object,
        continuation: () => void
    ) => void;
    pcdata?: (
        text: string,
        param: P,
        continuationMarker: object,
        continuation: () => void
    ) => void;
    rcdata?: (
        text: string,
        param: P,
        continuationMarker: object,
        continuation: () => void
    ) => void;
    cdata?: (
        text: string,
        param: P,
        continuationMarker: object,
        continuation: () => void
    ) => void;
    comment?: (
        text: string,
        param: P,
        continuationMarker: object,
        continuation: () => void
    ) => void;
}

interface ParsedTag {
    name: string;
    eflags: number;
    attrs: AttributeList;
    next: number;
}

interface ParseState {
    noMoreGT: boolean;
    noMoreEndComments: boolean;
}

interface TextAreaLike {
    innerHTML: string;
    textContent: string | null;
}

type ParseCssDeclarations = (
    cssText: string,
    handler: {
        declaration?: (property: string, tokens: string[]) => void;
    }
) => void;

type SanitizeCssProperty = (
    property: string,
    tokens: string[],
    uriRewriter: ((url: string) => string | null) | null
) => void;

interface WindowGlobals {
    parseCssDeclarations?: ParseCssDeclarations;
    sanitizeCssProperty?: SanitizeCssProperty;
    document?: {
        createElement(tagName: string): TextAreaLike;
    };
}

const browserWindow = (globalThis as unknown as { window?: WindowGlobals }).window;
const parseCssDeclarations = browserWindow && browserWindow.parseCssDeclarations;
const sanitizeCssProperty = browserWindow && browserWindow.sanitizeCssProperty;

const ENTITIES: Record<string, string> = {
    'lt': '<',
    'LT': '<',
    'gt': '>',
    'GT': '>',
    'amp': '&',
    'AMP': '&',
    'quot': '"',
    'apos': '\'',
    'nbsp': '\u00a0'
};

// Patterns for types of entity/character reference names.
const decimalEscapeRe = /^#(\d+)$/;
const hexEscapeRe = /^#x([0-9A-Fa-f]+)$/;
// contains every entity per http://www.w3.org/TR/2011/WD-html5-20110113/named-character-references.html
const safeEntityNameRe = /^[A-Za-z][A-za-z0-9]+$/;
const entityLookupElement: TextAreaLike | null =
    (browserWindow && browserWindow.document)
        ? browserWindow.document.createElement('textarea') : null;

/**
 * Decodes an HTML entity.
 *
 * @param name the content between the '&' and the ';'.
 * @return a single unicode code-point as a string.
 */
function lookupEntity(name: string): string {
    // TODO: entity lookup as specified by HTML5 actually depends on the
    // presence of the ";".
    if (Object.prototype.hasOwnProperty.call(ENTITIES, name)) {
        return ENTITIES[name];
    }
    let m = name.match(decimalEscapeRe);
    if (m) {
        return String.fromCharCode(parseInt(m[1], 10));
    } else if (!!(m = name.match(hexEscapeRe))) {
        return String.fromCharCode(parseInt(m[1], 16));
    } else if (entityLookupElement && safeEntityNameRe.test(name)) {
        entityLookupElement.innerHTML = '&' + name + ';';
        const text = entityLookupElement.textContent || '';
        ENTITIES[name] = text;
        return text;
    } else {
        return '&' + name + ';';
    }
}

function decodeOneEntity(_match: string, name: string): string {
    return lookupEntity(name);
}

const nulRe = /\0/g;
function stripNULs(s: string): string {
    return s.replace(nulRe, '');
}

const ENTITY_RE_1 = /&(#[0-9]+|#[xX][0-9A-Fa-f]+|\w+);/g;
const ENTITY_RE_2 = /^(#[0-9]+|#[xX][0-9A-Fa-f]+|\w+);/;

/**
 * The plain text of a chunk of HTML CDATA which possibly containing.
 *
 * @param s a chunk of HTML CDATA. It must not start or end inside an HTML
 *     entity.
 */
export function unescapeEntities(s: string): string;
export function unescapeEntities(s: null | undefined): null | undefined;
export function unescapeEntities(s: string | null | undefined): string | null | undefined {
    if (s) {
        return s.replace(ENTITY_RE_1, decodeOneEntity);
    }
    else {
        return s;
    }
}

const ampRe = /&/g;
const looseAmpRe = /&([^a-z#]|#(?:[^0-9x]|x(?:[^0-9a-f]|$)|$)|$)/gi;
const ltRe = /[<]/g;
const gtRe = />/g;
const quotRe = /\"/g;

/**
 * Escapes HTML special characters in attribute values.
 */
export function escapeAttrib(s: string): string;
export function escapeAttrib(s: null | undefined): null | undefined;
export function escapeAttrib(s: string | null | undefined): string | null | undefined {
    if (s) {
        return ('' + s).replace(ampRe, '&amp;').replace(ltRe, '&lt;')
            .replace(gtRe, '&gt;').replace(quotRe, '&#34;');
    }
    else {
        return s;
    }
}

/**
 * Escape entities in RCDATA that can be escaped without changing the meaning.
 */
export function normalizeRCData(rcdata: string): string;
export function normalizeRCData(rcdata: null | undefined): null | undefined;
export function normalizeRCData(rcdata: string | null | undefined): string | null | undefined {
    if (rcdata) {
        return rcdata
            .replace(looseAmpRe, '&amp;$1')
            .replace(ltRe, '&lt;')
            .replace(gtRe, '&gt;');
    }
    else {
        return rcdata;
    }
}

// We initially split input so that potentially meaningful characters
// like '<' and '>' are separate tokens, using a fast dumb process that
// ignores quoting.  Then we walk that token stream, and when we see a
// '<' that's the start of a tag, we use ATTR_RE to extract tag
// attributes from the next token.  That token will never have a '>'
// character.  However, it might have an unbalanced quote character, and
// when we see that, we combine additional tokens to balance the quote.

const ATTR_RE = new RegExp(
    '^\\s*' +
        '([-.:\\w]+)' +             // 1 = Attribute name
        '(?:' + (
        '\\s*(=)\\s*' +           // 2 = Is there a value?
            '(' + (                   // 3 = Attribute value
            // TODO(felix8a): maybe use backref to match quotes
            '(\")[^\"]*(\"|$)' +    // 4, 5 = Double-quoted string
                '|' +
                '(\')[^\']*(\'|$)' +    // 6, 7 = Single-quoted string
                '|' +
                // Positive lookahead to prevent interpretation of
                // <foo a= b=c> as <foo a='b=c'>
                // TODO(felix8a): might be able to drop this case
                '(?=[a-z][-\\w]*\\s*=)' +
                '|' +
                // Unquoted value that isn't an attribute name
                // (since we didn't match the positive lookahead above)
                '[^\"\'\\s]*' ) +
            ')' ) +
        ')?',
    'i');

// bitmask for tags with special parsing, like <script> and <textarea>
const EFLAGS_TEXT = html4.eflags['CDATA'] | html4.eflags['RCDATA'];

/**
 * Given a SAX-like event handler, produce a function that feeds those
 * events and a parameter to the event handler.
 *
 * @param handler a record containing event handlers.
 * @return A function that takes a chunk of HTML and a parameter.  The
 *     parameter is passed on to the handler methods.
 */
export function makeSaxParser<P>(
    handler: SaxHandler<P>
): (htmlText: string, param: P) => void {
    return function (htmlText: string, param: P): void {
        return parse(htmlText, handler, param);
    };
}

// Parsing strategy is to split input into parts that might be lexically
// meaningful (every ">" becomes a separate part), and then recombine
// parts if we discover they're in a different context.

const continuationMarker = {};

function parse<P>(htmlText: string, handler: SaxHandler<P>, param: P): void {
    const parts = htmlSplit(htmlText);
    const state: ParseState = {
        noMoreGT: false,
        noMoreEndComments: false
    };
    parseCPS(handler, parts, 0, state, param);
}

function continuationMaker<P>(
    h: SaxHandler<P>,
    parts: string[],
    initial: number,
    state: ParseState,
    param: P
): () => void {
    return function () {
        parseCPS(h, parts, initial, state, param);
    };
}

function parseCPS<P>(
    h: SaxHandler<P>,
    parts: string[],
    initial: number,
    state: ParseState,
    param: P
): void {
    try {
        if (h.startDoc && initial === 0) { h.startDoc(param); }
        let m: RegExpExecArray | null;
        let p: number;
        let tagName: string;
        for (let pos = initial, end = parts.length; pos < end;) {
            const current = parts[pos++];
            const next = parts[pos];
            switch (current) {
                case '&':
                    if (ENTITY_RE_2.test(next)) {
                        if (h.pcdata) {
                            h.pcdata('&' + next, param, continuationMarker,
                                continuationMaker(h, parts, pos, state, param));
                        }
                        pos++;
                    } else {
                        if (h.pcdata) { h.pcdata("&amp;", param, continuationMarker,
                            continuationMaker(h, parts, pos, state, param));
                        }
                    }
                    break;
                case '<\/':
                    if ((m = /^([-\w:]+)[^\'\"]*/.exec(next))) {
                        if (m[0].length === next.length && parts[pos + 1] === '>') {
                            // fast case, no attribute parsing needed
                            pos += 2;
                            tagName = m[1].toLowerCase();
                            if (h.endTag) {
                                h.endTag(tagName, param, continuationMarker,
                                    continuationMaker(h, parts, pos, state, param));
                            }
                        } else {
                            // slow case, need to parse attributes
                            // TODO(felix8a): do we really care about misparsing this?
                            pos = parseEndTag(
                                parts, pos, h, param, continuationMarker, state);
                        }
                    } else {
                        if (h.pcdata) {
                            h.pcdata('&lt;/', param, continuationMarker,
                                continuationMaker(h, parts, pos, state, param));
                        }
                    }
                    break;
                case '<':
                    if ((m = /^([-\w:]+)\s*\/?/.exec(next))) {
                        if (m[0].length === next.length && parts[pos + 1] === '>') {
                            // fast case, no attribute parsing needed
                            pos += 2;
                            tagName = m[1].toLowerCase();
                            if (h.startTag) {
                                h.startTag(tagName, [], param, continuationMarker,
                                    continuationMaker(h, parts, pos, state, param));
                            }
                            // tags like <script> and <textarea> have special parsing
                            const eflags = html4.ELEMENTS[tagName];
                            if (eflags & EFLAGS_TEXT) {
                                const tag: ParsedTag = {
                                    name: tagName, next: pos, eflags: eflags, attrs: []
                                };
                                pos = parseText(
                                    parts, tag, h, param, continuationMarker, state);
                            }
                        } else {
                            // slow case, need to parse attributes
                            pos = parseStartTag(
                                parts, pos, h, param, continuationMarker, state);
                        }
                    } else {
                        if (h.pcdata) {
                            h.pcdata('&lt;', param, continuationMarker,
                                continuationMaker(h, parts, pos, state, param));
                        }
                    }
                    break;
                case '<\!--':
                    // The pathological case is n copies of '<\!--' without '-->', and
                    // repeated failure to find '-->' is quadratic.  We avoid that by
                    // remembering when search for '-->' fails.
                    if (!state.noMoreEndComments) {
                        // A comment <\!--x--> is split into three tokens:
                        //   '<\!--', 'x--', '>'
                        // We want to find the next '>' token that has a preceding '--'.
                        // pos is at the 'x--'.
                        for (p = pos + 1; p < end; p++) {
                            if (parts[p] === '>' && /--$/.test(parts[p - 1])) { break; }
                        }
                        if (p < end) {
                            if (h.comment) {
                                const comment = parts.slice(pos, p).join('');
                                h.comment(
                                    comment.substr(0, comment.length - 2), param,
                                    continuationMarker,
                                    continuationMaker(h, parts, p + 1, state, param));
                            }
                            pos = p + 1;
                        } else {
                            state.noMoreEndComments = true;
                        }
                    }
                    if (state.noMoreEndComments) {
                        if (h.pcdata) {
                            h.pcdata('&lt;!--', param, continuationMarker,
                                continuationMaker(h, parts, pos, state, param));
                        }
                    }
                    break;
                case '<\!':
                    if (!/^\w/.test(next)) {
                        if (h.pcdata) {
                            h.pcdata('&lt;!', param, continuationMarker,
                                continuationMaker(h, parts, pos, state, param));
                        }
                    } else {
                        // similar to noMoreEndComment logic
                        if (!state.noMoreGT) {
                            for (p = pos + 1; p < end; p++) {
                                if (parts[p] === '>') { break; }
                            }
                            if (p < end) {
                                pos = p + 1;
                            } else {
                                state.noMoreGT = true;
                            }
                        }
                        if (state.noMoreGT) {
                            if (h.pcdata) {
                                h.pcdata('&lt;!', param, continuationMarker,
                                    continuationMaker(h, parts, pos, state, param));
                            }
                        }
                    }
                    break;
                case '<?':
                    // similar to noMoreEndComment logic
                    if (!state.noMoreGT) {
                        for (p = pos + 1; p < end; p++) {
                            if (parts[p] === '>') { break; }
                        }
                        if (p < end) {
                            pos = p + 1;
                        } else {
                            state.noMoreGT = true;
                        }
                    }
                    if (state.noMoreGT) {
                        if (h.pcdata) {
                            h.pcdata('&lt;?', param, continuationMarker,
                                continuationMaker(h, parts, pos, state, param));
                        }
                    }
                    break;
                case '>':
                    if (h.pcdata) {
                        h.pcdata("&gt;", param, continuationMarker,
                            continuationMaker(h, parts, pos, state, param));
                    }
                    break;
                case '':
                    break;
                default:
                    if (h.pcdata) {
                        h.pcdata(current, param, continuationMarker,
                            continuationMaker(h, parts, pos, state, param));
                    }
                    break;
            }
        }
        if (h.endDoc) { h.endDoc(param); }
    } catch (e) {
        if (e !== continuationMarker) { throw e; }
    }
}

/** Split str into parts for the html parser. */
function htmlSplit(str: string): string[] {
    // can't hoist this out of the function because of the re.exec loop.
    const re = /(<\/|<\!--|<[!?]|[&<>])/g;
    const text = str + '';
    return text.split(re);
}

function parseEndTag<P>(
    parts: string[],
    pos: number,
    h: SaxHandler<P>,
    param: P,
    continuationMarker: object,
    state: ParseState
): number {
    const tag = parseTagAndAttrs(parts, pos);
    // drop unclosed tags
    if (!tag) { return parts.length; }
    if (h.endTag) {
        h.endTag(tag.name, param, continuationMarker,
            continuationMaker(h, parts, pos, state, param));
    }
    return tag.next;
}

function parseStartTag<P>(
    parts: string[],
    pos: number,
    h: SaxHandler<P>,
    param: P,
    continuationMarker: object,
    state: ParseState
): number {
    const tag = parseTagAndAttrs(parts, pos);
    // drop unclosed tags
    if (!tag) { return parts.length; }
    if (h.startTag) {
        h.startTag(tag.name, tag.attrs, param, continuationMarker,
            continuationMaker(h, parts, tag.next, state, param));
    }
    // tags like <script> and <textarea> have special parsing
    if (tag.eflags & EFLAGS_TEXT) {
        return parseText(parts, tag, h, param, continuationMarker, state);
    } else {
        return tag.next;
    }
}

const endTagRe: Record<string, RegExp> = {};

// Tags like <script> and <textarea> are flagged as CDATA or RCDATA,
// which means everything is text until we see the correct closing tag.
function parseText<P>(
    parts: string[],
    tag: ParsedTag,
    h: SaxHandler<P>,
    param: P,
    continuationMarker: object,
    state: ParseState
): number {
    const end = parts.length;
    if (!Object.prototype.hasOwnProperty.call(endTagRe, tag.name)) {
        endTagRe[tag.name] = new RegExp('^' + tag.name + '(?:[\\s\\/]|$)', 'i');
    }
    const re = endTagRe[tag.name];
    const first = tag.next;
    let p = tag.next + 1;
    for (; p < end; p++) {
        if (parts[p - 1] === '<\/' && re.test(parts[p])) { break; }
    }
    if (p < end) { p -= 1; }
    const buf = parts.slice(first, p).join('');
    if (tag.eflags & html4.eflags['CDATA']) {
        if (h.cdata) {
            h.cdata(buf, param, continuationMarker,
                continuationMaker(h, parts, p, state, param));
        }
    } else if (tag.eflags & html4.eflags['RCDATA']) {
        if (h.rcdata) {
            h.rcdata(normalizeRCData(buf), param, continuationMarker,
                continuationMaker(h, parts, p, state, param));
        }
    } else {
        throw new Error('bug');
    }
    return p;
}

// at this point, parts[pos-1] is either "<" or "<\/".
function parseTagAndAttrs(parts: string[], pos: number): ParsedTag | undefined {
    let m = /^([-\w:]+)/.exec(parts[pos]);
    if (!m) { return undefined; }
    const name = m[1].toLowerCase();
    const eflags = html4.ELEMENTS[name];
    let buf = parts[pos].substr(m[0].length);
    // Find the next '>'.  We optimistically assume this '>' is not in a
    // quoted context, and further down we fix things up if it turns out to
    // be quoted.
    let p = pos + 1;
    const end = parts.length;
    for (; p < end; p++) {
        if (parts[p] === '>') { break; }
        buf += parts[p];
    }
    if (end <= p) { return undefined; }
    const attrs: AttributeList = [];
    while (buf !== '') {
        m = ATTR_RE.exec(buf);
        if (!m) {
            // No attribute found: skip garbage
            buf = buf.replace(/^[\s\S][^a-z\s]*/, '');

        } else if ((m[4] && !m[5]) || (m[6] && !m[7])) {
            // Unterminated quote: slurp to the next unquoted '>'
            const quote = m[4] || m[6];
            let sawQuote = false;
            const abuf = [buf, parts[p++]];
            for (; p < end; p++) {
                if (sawQuote) {
                    if (parts[p] === '>') { break; }
                } else if (0 <= parts[p].indexOf(quote)) {
                    sawQuote = true;
                }
                abuf.push(parts[p]);
            }
            // Slurp failed: lose the garbage
            if (end <= p) { break; }
            // Otherwise retry attribute parsing
            buf = abuf.join('');
            continue;

        } else {
            // We have an attribute
            const aName = m[1].toLowerCase();
            const aValue = m[2] ? decodeValue(m[3]) : '';
            attrs.push(aName, aValue);
            buf = buf.substr(m[0].length);
        }
    }
    return { name, eflags, attrs, next: p + 1 };
}

function decodeValue(v: string): string {
    const q = v.charCodeAt(0);
    if (q === 0x22 || q === 0x27) { // " or '
        v = v.substr(1, v.length - 2);
    }
    return unescapeEntities(stripNULs(v));
}

/**
 * Returns a function that strips unsafe tags and attributes from html.
 * @param tagPolicy A function that takes (tagName, attribs[]), where tagName is
 *     a key in html4.ELEMENTS and attribs is an array of alternating attribute
 *     names and values.  It should return a record (as follows), or null to
 *     delete the element.  It's okay for tagPolicy to modify the attribs array,
 *     but the same array is reused, so it should not be held between calls.
 *     Record keys:
 *        attribs: (required) Sanitized attributes array.
 *        tagName: Replacement tag name.
 * @return A function that sanitizes a string of HTML and appends result
 *     strings to the second argument, an array.
 */
export function makeHtmlSanitizer(
    tagPolicy: TagPolicy
): (htmlText: string, out: string[]) => void {
    let stack: Array<{ orig: string; rep: string }>;
    let ignoring: boolean;
    const emit = function (text: string, out: string[]): void {
        if (!ignoring) { out.push(text); }
    };
    return makeSaxParser<string[]>({
        'startDoc': function (_param: string[]): void {
            stack = [];
            ignoring = false;
        },
        'startTag': function (
            tagNameOrig: string,
            attribs: AttributeList,
            out: string[]
        ): void {
            if (ignoring) { return; }
            if (!Object.prototype.hasOwnProperty.call(html4.ELEMENTS, tagNameOrig)) { return; }
            const eflagsOrig = html4.ELEMENTS[tagNameOrig];
            if (eflagsOrig & html4.eflags['FOLDABLE']) {
                return;
            }

            const decision = tagPolicy(tagNameOrig, attribs);
            if (!decision) {
                ignoring = !(eflagsOrig & html4.eflags['EMPTY']);
                return;
            } else if (typeof decision !== 'object') {
                throw new Error('tagPolicy did not return object (old API?)');
            }
            if ('attribs' in decision) {
                attribs = decision['attribs'];
            } else {
                throw new Error('tagPolicy gave no attribs');
            }
            let eflagsRep: number;
            let tagNameRep: string;
            if ('tagName' in decision) {
                tagNameRep = decision['tagName'] as string;
                eflagsRep = html4.ELEMENTS[tagNameRep];
            } else {
                tagNameRep = tagNameOrig;
                eflagsRep = eflagsOrig;
            }
            // TODO(mikesamuel): relying on tagPolicy not to insert unsafe
            // attribute names.

            // If this is an optional-end-tag element and either this element or its
            // previous like sibling was rewritten, then insert a close tag to
            // preserve structure.
            if (eflagsOrig & html4.eflags['OPTIONAL_ENDTAG']) {
                const onStack = stack[stack.length - 1];
                if (onStack && onStack.orig === tagNameOrig &&
                    (onStack.rep !== tagNameRep || tagNameOrig !== tagNameRep)) {
                    out.push('<\/', onStack.rep, '>');
                }
            }

            if (!(eflagsOrig & html4.eflags['EMPTY'])) {
                stack.push({ orig: tagNameOrig, rep: tagNameRep });
            }

            out.push('<', tagNameRep);
            for (let i = 0, n = attribs.length; i < n; i += 2) {
                const attribName = attribs[i] as string;
                const value = attribs[i + 1];
                if (value !== null && value !== undefined) {
                    out.push(' ', attribName, '="', escapeAttrib(value), '"');
                }
            }
            out.push('>');

            if ((eflagsOrig & html4.eflags['EMPTY'])
                && !(eflagsRep & html4.eflags['EMPTY'])) {
                // replacement is non-empty, synthesize end tag
                out.push('<\/', tagNameRep, '>');
            }
        },
        'endTag': function (tagName: string, out: string[]): void {
            if (ignoring) {
                ignoring = false;
                return;
            }
            if (!Object.prototype.hasOwnProperty.call(html4.ELEMENTS, tagName)) { return; }
            const eflags = html4.ELEMENTS[tagName];
            if (!(eflags & (html4.eflags['EMPTY'] | html4.eflags['FOLDABLE']))) {
                let index: number;
                if (eflags & html4.eflags['OPTIONAL_ENDTAG']) {
                    for (index = stack.length; --index >= 0;) {
                        const stackElOrigTag = stack[index].orig;
                        if (stackElOrigTag === tagName) { break; }
                        if (!(html4.ELEMENTS[stackElOrigTag] &
                            html4.eflags['OPTIONAL_ENDTAG'])) {
                            // Don't pop non optional end tags looking for a match.
                            return;
                        }
                    }
                } else {
                    for (index = stack.length; --index >= 0;) {
                        if (stack[index].orig === tagName) { break; }
                    }
                }
                if (index < 0) { return; }  // Not opened.
                for (let i = stack.length; --i > index;) {
                    const stackElRepTag = stack[i].rep;
                    if (!(html4.ELEMENTS[stackElRepTag] &
                        html4.eflags['OPTIONAL_ENDTAG'])) {
                        out.push('<\/', stackElRepTag, '>');
                    }
                }
                if (index < stack.length) {
                    tagName = stack[index].rep;
                }
                stack.length = index;
                out.push('<\/', tagName, '>');
            }
        },
        'pcdata': emit,
        'rcdata': emit,
        'cdata': emit,
        'endDoc': function (out: string[]): void {
            for (; stack.length; stack.length--) {
                out.push('<\/', stack[stack.length - 1].rep, '>');
            }
        }
    });
}

const ALLOWED_URI_SCHEMES = /^(?:https?|mailto)$/i;

function safeUri(
    uri: unknown,
    effect: number | undefined,
    ltype: number | undefined,
    hints: Record<string, string>,
    naiveUriRewriter: NaiveUriRewriter | null | undefined
): string | null {
    if (!naiveUriRewriter) { return null; }
    try {
        const parsed = URI.parse('' + uri);
        if (parsed) {
            if (!parsed.hasScheme() ||
                ALLOWED_URI_SCHEMES.test(parsed.getScheme() ?? '')) {
                const safe = naiveUriRewriter(parsed, effect, ltype, hints);
                return safe ? safe.toString() : null;
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}

function log(
    logger: SanitizerLogger,
    tagName: string,
    attribName?: string | null,
    oldValue?: string | null,
    newValue?: string | null
): void {
    if (!attribName) {
        logger(tagName + " removed", {
            change: "removed",
            tagName: tagName
        });
    }
    if (oldValue !== newValue) {
        let changed: 'removed' | 'changed' | 'added' = "changed";
        if (oldValue && !newValue) {
            changed = "removed";
        } else if (!oldValue && newValue) {
            changed = "added";
        }
        logger(tagName + "." + attribName + " " + changed, {
            change: changed,
            tagName: tagName,
            attribName: attribName ?? undefined,
            oldValue: oldValue,
            newValue: newValue
        });
    }
}

function lookupAttribute(
    map: Record<string, number>,
    tagName: string,
    attribName: string
): number | undefined {
    let attribKey = tagName + '::' + attribName;
    if (Object.prototype.hasOwnProperty.call(map, attribKey)) {
        return map[attribKey];
    }
    attribKey = '*::' + attribName;
    if (Object.prototype.hasOwnProperty.call(map, attribKey)) {
        return map[attribKey];
    }
    return undefined;
}

function getAttributeType(tagName: string, attribName: string): number | undefined {
    return lookupAttribute(html4.ATTRIBS, tagName, attribName);
}

function getLoaderType(tagName: string, attribName: string): number | undefined {
    return lookupAttribute(html4.LOADERTYPES, tagName, attribName);
}

function getUriEffect(tagName: string, attribName: string): number | undefined {
    return lookupAttribute(html4.URIEFFECTS, tagName, attribName);
}

/**
 * Sanitizes attributes on an HTML tag.
 * @param tagName An HTML tag name in lowercase.
 * @param attribs An array of alternating names and values.
 * @param opt_naiveUriRewriter A transform to apply to URI attributes; it can
 *     return a new string value, or null to delete the attribute.  If
 *     unspecified, URI attributes are deleted.
 * @param opt_nmTokenPolicy A transform to apply to attributes containing HTML
 *     names, element IDs, and space-separated lists of classes; it can return
 *     a new string value, or null to delete the attribute.  If unspecified,
 *     these attributes are kept unchanged.
 * @return The sanitized attributes as a list of alternating names and values,
 *     where a null value means to omit the attribute.
 */
export function sanitizeAttribs(
    tagName: string,
    attribs: AttributeList,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): AttributeList {
    // TODO(felix8a): it's obnoxious that domado duplicates much of this
    // TODO(felix8a): maybe consistently enforce constraints like target=
    for (let i = 0; i < attribs.length; i += 2) {
        const attribName = attribs[i] as string;
        const oldValue = attribs[i + 1];
        let value: string | null = oldValue;
        const atype = getAttributeType(tagName, attribName);
        if (atype !== undefined && atype !== null) {
            switch (atype) {
                case html4.atype['NONE']: break;
                case html4.atype['SCRIPT']:
                    value = null;
                    if (opt_logger) {
                        log(opt_logger, tagName, attribName, oldValue, value);
                    }
                    break;
                case html4.atype['STYLE']:
                    if (!parseCssDeclarations) {
                        value = null;
                        if (opt_logger) {
                            log(opt_logger, tagName, attribName, oldValue, value);
                        }
                        break;
                    }
                    const sanitizedDeclarations: string[] = [];
                    parseCssDeclarations(
                        value ?? '',
                        {
                            'declaration': function (property: string, tokens: string[]): void {
                                const normProp = property.toLowerCase();
                                sanitizeCssProperty!(
                                    normProp, tokens,
                                    opt_naiveUriRewriter
                                        ? function (url: string): string | null {
                                        return safeUri(
                                            url, undefined,
                                            undefined,
                                            {
                                                "TYPE": "CSS",
                                                "CSS_PROP": normProp
                                            }, opt_naiveUriRewriter);
                                    }
                                        : null);
                                if (tokens.length) {
                                    sanitizedDeclarations.push(
                                        normProp + ': ' + tokens.join(' '));
                                }
                            }
                        });
                    value = sanitizedDeclarations.length > 0 ?
                        sanitizedDeclarations.join(' ; ') : null;
                    if (opt_logger) {
                        log(opt_logger, tagName, attribName, oldValue, value);
                    }
                    break;
                case html4.atype['ID']:
                case html4.atype['IDREF']:
                case html4.atype['IDREFS']:
                case html4.atype['GLOBAL_NAME']:
                case html4.atype['LOCAL_NAME']:
                case html4.atype['CLASSES']:
                    value = opt_nmTokenPolicy ? opt_nmTokenPolicy(value as string) : value;
                    if (opt_logger) {
                        log(opt_logger, tagName, attribName, oldValue, value);
                    }
                    break;
                case html4.atype['URI']:
                    value = safeUri(value,
                        getUriEffect(tagName, attribName),
                        getLoaderType(tagName, attribName),
                        {
                            "TYPE": "MARKUP",
                            "XML_ATTR": attribName,
                            "XML_TAG": tagName
                        }, opt_naiveUriRewriter);
                    if (opt_logger) {
                        log(opt_logger, tagName, attribName, oldValue, value);
                    }
                    break;
                case html4.atype['URI_FRAGMENT']:
                    if (value && '#' === value.charAt(0)) {
                        value = value.substring(1);  // remove the leading '#'
                        value = opt_nmTokenPolicy ? opt_nmTokenPolicy(value) : value;
                        if (value !== null && value !== undefined) {
                            value = '#' + value;  // restore the leading '#'
                        }
                    } else {
                        value = null;
                    }
                    if (opt_logger) {
                        log(opt_logger, tagName, attribName, oldValue, value);
                    }
                    break;
                default:
                    value = null;
                    if (opt_logger) {
                        log(opt_logger, tagName, attribName, oldValue, value);
                    }
                    break;
            }
        } else {
            value = null;
            if (opt_logger) {
                log(opt_logger, tagName, attribName, oldValue, value);
            }
        }
        attribs[i + 1] = value;
    }
    return attribs;
}

/**
 * Creates a tag policy that omits all tags marked UNSAFE in html4-defs.js
 * and applies the default attribute sanitizer with the supplied policy for
 * URI attributes and NMTOKEN attributes.
 * @param opt_naiveUriRewriter A transform to apply to URI attributes.  If not
 *     given, URI attributes are deleted.
 * @param opt_nmTokenPolicy A transform to apply to attributes containing HTML
 *     names, element IDs, and space-separated lists of classes.  If not given,
 *     such attributes are left unchanged.
 * @return A tagPolicy suitable for passing to html.sanitize.
 */
export function makeTagPolicy(
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): TagPolicy {
    return function (tagName: string, attribs: AttributeList): TagPolicyDecision | undefined {
        if (!(html4.ELEMENTS[tagName] & html4.eflags['UNSAFE'])) {
            return {
                'attribs': sanitizeAttribs(tagName, attribs,
                    opt_naiveUriRewriter, opt_nmTokenPolicy, opt_logger)
            };
        } else {
            if (opt_logger) {
                log(opt_logger, tagName, undefined, undefined, undefined);
            }
        }
    };
}

/**
 * Sanitizes HTML tags and attributes according to a given policy.
 * @param inputHtml The HTML to sanitize.
 * @param tagPolicy A function that decides which tags to accept and sanitizes
 *     their attributes (see makeHtmlSanitizer above for details).
 * @return The sanitized HTML.
 */
export function sanitizeWithPolicy(inputHtml: string, tagPolicy: TagPolicy): string {
    const outputArray: string[] = [];
    makeHtmlSanitizer(tagPolicy)(inputHtml, outputArray);
    return outputArray.join('');
}

/**
 * Strips unsafe tags and attributes from HTML.
 * @param inputHtml The HTML to sanitize.
 * @param opt_naiveUriRewriter A transform to apply to URI attributes.  If not
 *     given, URI attributes are deleted.
 * @param opt_nmTokenPolicy A transform to apply to attributes containing HTML
 *     names, element IDs, and space-separated lists of classes.  If not given,
 *     such attributes are left unchanged.
 */
export function sanitize(
    inputHtml: string,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): string;
export function sanitize(
    inputHtml: null | undefined,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): null | undefined;
export function sanitize(
    inputHtml: string | null | undefined,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): string | null | undefined {
    const tagPolicy = makeTagPolicy(
        opt_naiveUriRewriter, opt_nmTokenPolicy, opt_logger);
    return sanitizeWithPolicy(inputHtml as string, tagPolicy);
}

export interface HtmlApi {
    escapeAttrib: typeof escapeAttrib;
    makeHtmlSanitizer: typeof makeHtmlSanitizer;
    makeSaxParser: typeof makeSaxParser;
    makeTagPolicy: typeof makeTagPolicy;
    normalizeRCData: typeof normalizeRCData;
    sanitize: typeof sanitize;
    sanitizeAttribs: typeof sanitizeAttribs;
    sanitizeWithPolicy: typeof sanitizeWithPolicy;
    unescapeEntities: typeof unescapeEntities;
}

const html: HtmlApi = {
    escapeAttrib,
    makeHtmlSanitizer,
    makeSaxParser,
    makeTagPolicy,
    normalizeRCData,
    sanitize,
    sanitizeAttribs,
    sanitizeWithPolicy,
    unescapeEntities
};

export const html_sanitize = html.sanitize;

// Exports for Closure compiler.  Note this file is also cajoled
// for domado and run in an environment without 'window'
if (browserWindow) {
    (browserWindow as unknown as Record<string, unknown>)['html'] = html;
    (browserWindow as unknown as Record<string, unknown>)['html_sanitize'] = html_sanitize;
}

/**
 * Backwards compatible entry point: rewrites self-closing tags to explicit
 * open/close pairs before sanitizing.
 *
 * See https://github.com/theSmaw/Caja-HTML-Sanitizer/issues/8
 */
export function sanitizeCompat(
    inputHtml: string,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): string;
export function sanitizeCompat(
    inputHtml: null | undefined,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): null | undefined;
export function sanitizeCompat(
    inputHtml: string | null | undefined,
    opt_naiveUriRewriter?: NaiveUriRewriter | null,
    opt_nmTokenPolicy?: NmTokenPolicy | null,
    opt_logger?: SanitizerLogger | null
): string | null | undefined {
    let input = inputHtml;
    if (typeof input === "string") {
        input = input.replace(/<([a-zA-Z]+)([^>]*)\/>/g, '<$1$2></$1>');
    }

    if (input) {
        return html.sanitize(input, opt_naiveUriRewriter, opt_nmTokenPolicy, opt_logger);
    }
    else {
        return input;
    }
}

export interface SanitizerApi {
    escapeAttrib: typeof escapeAttrib;
    makeHtmlSanitizer: typeof makeHtmlSanitizer;
    makeSaxParser: typeof makeSaxParser;
    makeTagPolicy: typeof makeTagPolicy;
    normalizeRCData: typeof normalizeRCData;
    sanitizeAttribs: typeof sanitizeAttribs;
    sanitizeWithPolicy: typeof sanitizeWithPolicy;
    unescapeEntities: typeof unescapeEntities;
    escape: typeof escapeAttrib;
    sanitize: typeof sanitizeCompat;
}

// Ensure backwards compatibility
const Sanitizer: SanitizerApi = {
    escapeAttrib,
    makeHtmlSanitizer,
    makeSaxParser,
    makeTagPolicy,
    normalizeRCData,
    sanitizeAttribs,
    sanitizeWithPolicy,
    unescapeEntities,
    escape: escapeAttrib,
    sanitize: sanitizeCompat
};

export { Sanitizer, html };
export default Sanitizer;
