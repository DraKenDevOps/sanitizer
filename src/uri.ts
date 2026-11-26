/**
 * Implements RFC 3986 for parsing/formatting URIs.
 *
 * Ported from uri.js (Caja, Apache-2.0, author mikesamuel@gmail.com).
 */

export type QueryParameters = string[] | Record<string, string>;

export class URI {
    private scheme_: string | null;
    private credentials_: string | null;
    private domain_: string | null;
    private port_: string | null;
    private path_: string | null;
    private query_: string | null;
    private fragment_: string | null;
    private paramCache_: string[] | null = null;

    /**
     * The parameters are all raw (assumed to be properly escaped) parts, and
     * any (but not all) may be null. Undefined is not allowed.
     */
    constructor(
        rawScheme: string | null,
        rawCredentials: string | null,
        rawDomain: string | null,
        port: string | null,
        rawPath: string | null,
        rawQuery: string | null,
        rawFragment: string | null
    ) {
        this.scheme_ = rawScheme;
        this.credentials_ = rawCredentials;
        this.domain_ = rawDomain;
        this.port_ = port;
        this.path_ = rawPath;
        this.query_ = rawQuery;
        this.fragment_ = rawFragment;
    }

    /** Returns the string form of the url. */
    toString(): string {
        const out: string[] = [];
        if (this.scheme_ !== null) { out.push(this.scheme_, ':'); }
        if (this.domain_ !== null) {
            out.push('//');
            if (this.credentials_ !== null) { out.push(this.credentials_, '@'); }
            out.push(this.domain_);
            if (this.port_ !== null) { out.push(':', this.port_); }
        }
        if (this.path_ !== null) { out.push(this.path_); }
        if (this.query_ !== null) { out.push('?', this.query_); }
        if (this.fragment_ !== null) { out.push('#', this.fragment_); }
        return out.join('');
    }

    clone(): URI {
        return new URI(this.scheme_, this.credentials_, this.domain_, this.port_,
            this.path_, this.query_, this.fragment_);
    }

    getScheme(): string | null {
        // HTML5 spec does not require the scheme to be lowercased but
        // all common browsers except Safari lowercase the scheme.
        return this.scheme_ && decodeURIComponent(this.scheme_).toLowerCase();
    }

    getRawScheme(): string | null {
        return this.scheme_;
    }

    setScheme(newScheme: string | null): this {
        this.scheme_ = encodeIfExists2(
            newScheme, URI_DISALLOWED_IN_SCHEME_OR_CREDENTIALS_);
        return this;
    }

    setRawScheme(newScheme: string | null): this {
        this.scheme_ = newScheme ? newScheme : null;
        return this;
    }

    hasScheme(): boolean {
        return this.scheme_ !== null;
    }

    getCredentials(): string | null {
        return this.credentials_ && decodeURIComponent(this.credentials_);
    }

    getRawCredentials(): string | null {
        return this.credentials_;
    }

    setCredentials(newCredentials: string | null): this {
        this.credentials_ = encodeIfExists2(
            newCredentials, URI_DISALLOWED_IN_SCHEME_OR_CREDENTIALS_);
        return this;
    }

    setRawCredentials(newCredentials: string | null): this {
        this.credentials_ = newCredentials ? newCredentials : null;
        return this;
    }

    hasCredentials(): boolean {
        return this.credentials_ !== null;
    }

    getDomain(): string | null {
        return this.domain_ && decodeURIComponent(this.domain_);
    }

    getRawDomain(): string | null {
        return this.domain_;
    }

    setDomain(newDomain: string | null): this {
        return this.setRawDomain(newDomain && encodeURIComponent(newDomain));
    }

    setRawDomain(newDomain: string | null): this {
        this.domain_ = newDomain ? newDomain : null;
        // Maintain the invariant that paths must start with a slash when the
        // URI is not path-relative.
        return this.setRawPath(this.path_);
    }

    hasDomain(): boolean {
        return this.domain_ !== null;
    }

    getPort(): string | null {
        return this.port_ && decodeURIComponent(this.port_);
    }

    setPort(newPort: string | number | null): this {
        if (newPort) {
            const port = Number(newPort);
            if (port !== (port & 0xffff)) {
                throw new Error('Bad port number ' + port);
            }
            this.port_ = '' + port;
        } else {
            this.port_ = null;
        }
        return this;
    }

    hasPort(): boolean {
        return this.port_ !== null;
    }

    getPath(): string | null {
        return this.path_ && decodeURIComponent(this.path_);
    }

    getRawPath(): string | null {
        return this.path_;
    }

    setPath(newPath: string | null): this {
        return this.setRawPath(encodeIfExists2(newPath, URI_DISALLOWED_IN_PATH_));
    }

    setRawPath(newPath: string | null): this {
        if (newPath) {
            const path = String(newPath);
            // Paths must start with '/' unless this is a path-relative URL.
            this.path_ = (!this.domain_ || /^\//.test(path)) ? path : '/' + path;
        } else {
            this.path_ = null;
        }
        return this;
    }

    hasPath(): boolean {
        return this.path_ !== null;
    }

    getQuery(): string | null {
        // From http://www.w3.org/Addressing/URL/4_URI_Recommentations.html
        // Within the query string, the plus sign is reserved as shorthand
        // notation for a space.
        return this.query_ && decodeURIComponent(this.query_).replace(/\+/g, ' ');
    }

    getRawQuery(): string | null {
        return this.query_;
    }

    setQuery(newQuery: string | null): this {
        this.paramCache_ = null;
        this.query_ = encodeIfExists(newQuery);
        return this;
    }

    setRawQuery(newQuery: string | null): this {
        this.paramCache_ = null;
        this.query_ = newQuery ? newQuery : null;
        return this;
    }

    hasQuery(): boolean {
        return this.query_ !== null;
    }

    /**
     * Sets the query given a list of strings of the form
     * [ key0, value0, key1, value1, ... ].
     *
     * <p><code>uri.setAllParameters(['a', 'b', 'c', 'd']).getQuery()</code>
     * will yield <code>'a=b&c=d'</code>.
     */
    setAllParameters(params: QueryParameters): this {
        let list: string[];
        if (typeof params === 'object' && !(params instanceof Array)) {
            const newParams: string[] = [];
            for (const k in params) {
                const v = params[k];
                if (typeof v === 'string') {
                    newParams.push(k, v);
                }
            }
            list = newParams;
        } else {
            list = params as string[];
        }
        this.paramCache_ = null;
        const queryBuf: string[] = [];
        let separator = '';
        for (let j = 0; j < list.length;) {
            const k = list[j++];
            const v = list[j++];
            queryBuf.push(separator, encodeURIComponent(k.toString()));
            separator = '&';
            if (v) {
                queryBuf.push('=', encodeURIComponent(v.toString()));
            }
        }
        this.query_ = queryBuf.join('');
        return this;
    }

    private checkParameterCache_(): void {
        if (!this.paramCache_) {
            const q = this.query_;
            if (!q) {
                this.paramCache_ = [];
            } else {
                const cgiParams = q.split(/[&\?]/);
                const out: string[] = [];
                for (let i = 0; i < cgiParams.length; ++i) {
                    const m = cgiParams[i].match(/^([^=]*)(?:=(.*))?$/);
                    if (!m) { continue; }
                    // From http://www.w3.org/Addressing/URL/4_URI_Recommentations.html
                    // Within the query string, the plus sign is reserved as shorthand
                    // notation for a space.
                    out.push(decodeURIComponent(m[1]).replace(/\+/g, ' '));
                    out.push(decodeURIComponent(m[2] || '').replace(/\+/g, ' '));
                }
                this.paramCache_ = out;
            }
        }
    }

    /**
     * Sets the values of the named cgi parameters.
     *
     * <p>So, <code>uri.parse('foo?a=b&c=d&e=f').setParameterValues('c', ['new'])
     * </code> yields <tt>foo?a=b&c=new&e=f</tt>.</p>
     */
    setParameterValues(key: string, values: string | string[]): this {
        // be nice and avoid subtle bugs where [] operator on string performs charAt
        // on some browsers and crashes on IE
        const newValues = typeof values === 'string' ? [values] : values;

        this.checkParameterCache_();
        let newValueIndex = 0;
        const pc = this.paramCache_!;
        const params: string[] = [];
        for (let i = 0; i < pc.length; i += 2) {
            if (key === pc[i]) {
                if (newValueIndex < newValues.length) {
                    params.push(key, newValues[newValueIndex++]);
                }
            } else {
                params.push(pc[i], pc[i + 1]);
            }
        }
        while (newValueIndex < newValues.length) {
            params.push(key, newValues[newValueIndex++]);
        }
        this.setAllParameters(params);
        return this;
    }

    removeParameter(key: string): this {
        return this.setParameterValues(key, []);
    }

    /**
     * Returns the parameters specified in the query part of the uri as a list of
     * keys and values like [ key0, value0, key1, value1, ... ].
     */
    getAllParameters(): string[] {
        this.checkParameterCache_();
        return this.paramCache_!.slice(0, this.paramCache_!.length);
    }

    /**
     * Returns the value<b>s</b> for a given cgi parameter as a list of decoded
     * query parameter values.
     */
    getParameterValues(paramNameUnescaped: string): string[] {
        this.checkParameterCache_();
        const values: string[] = [];
        for (let i = 0; i < this.paramCache_!.length; i += 2) {
            if (paramNameUnescaped === this.paramCache_![i]) {
                values.push(this.paramCache_![i + 1]);
            }
        }
        return values;
    }

    /**
     * Returns a map of cgi parameter names to (non-empty) lists of values.
     *
     * Note: kept byte-for-byte compatible with the original implementation,
     * including its double increment of the loop index.
     */
    getParameterMap(): Record<string, string[]> {
        this.checkParameterCache_();
        const paramMap: Record<string, string[]> = {};
        const pc = this.paramCache_!;
        for (let i = 0; i < pc.length; i += 2) {
            const key = pc[i++];
            const value = pc[i++];
            if (!(key in paramMap)) {
                paramMap[key] = [value];
            } else {
                paramMap[key].push(value);
            }
        }
        return paramMap;
    }

    /**
     * Returns the first value for a given cgi parameter or null if the given
     * parameter name does not appear in the query string.
     * If the given parameter name does appear, but has no '<tt>=</tt>' following
     * it, then the empty string will be returned.
     */
    getParameterValue(paramNameUnescaped: string): string | null {
        this.checkParameterCache_();
        for (let i = 0; i < this.paramCache_!.length; i += 2) {
            if (paramNameUnescaped === this.paramCache_![i]) {
                return this.paramCache_![i + 1];
            }
        }
        return null;
    }

    getFragment(): string | null {
        return this.fragment_ && decodeURIComponent(this.fragment_);
    }

    getRawFragment(): string | null {
        return this.fragment_;
    }

    setFragment(newFragment: string | null): this {
        this.fragment_ = newFragment ? encodeURIComponent(newFragment) : null;
        return this;
    }

    setRawFragment(newFragment: string | null): this {
        this.fragment_ = newFragment ? newFragment : null;
        return this;
    }

    hasFragment(): boolean {
        return this.fragment_ !== null;
    }

    /**
     * Creates a uri from the string form. The parser is relaxed, so special
     * characters that aren't escaped but don't cause ambiguities will not cause
     * parse failures.
     */
    static parse(uriStr: string): URI | null {
        const m = ('' + uriStr).match(URI_RE_);
        if (!m) { return null; }
        return new URI(
            nullIfAbsent(m[1]),
            nullIfAbsent(m[2]),
            nullIfAbsent(m[3]),
            nullIfAbsent(m[4]),
            nullIfAbsent(m[5]),
            nullIfAbsent(m[6]),
            nullIfAbsent(m[7]));
    }

    /**
     * Creates a uri from the given parts.
     *
     * @param scheme an unencoded scheme such as "http" or null
     * @param credentials unencoded user credentials or null
     * @param domain an unencoded domain name or null
     * @param port a port number in [1, 32768]. -1 indicates no port, as does null.
     * @param path an unencoded path
     * @param query a list of unencoded cgi parameters where even values are keys
     *   and odds the corresponding values, or an unencoded query
     * @param fragment an unencoded fragment without the "#" or null
     */
    static create(
        scheme: string | null,
        credentials: string | null,
        domain: string | null,
        port: number | null,
        path: string | null,
        query: QueryParameters | string | null,
        fragment: string | null
    ): URI {
        const uri = new URI(
            encodeIfExists2(scheme, URI_DISALLOWED_IN_SCHEME_OR_CREDENTIALS_),
            encodeIfExists2(
                credentials, URI_DISALLOWED_IN_SCHEME_OR_CREDENTIALS_),
            encodeIfExists(domain),
            port && port > 0 ? port.toString() : null,
            encodeIfExists2(path, URI_DISALLOWED_IN_PATH_),
            null,
            encodeIfExists(fragment));
        if (query) {
            if (typeof query === 'string') {
                uri.setRawQuery(query.replace(/[^?&=0-9A-Za-z_\-~.%]/g, encodeOne));
            } else {
                uri.setAllParameters(query);
            }
        }
        return uri;
    }

    /** Resolves a relative url string to a base uri. */
    static resolve(baseUri: URI, relativeUri: URI): URI {
        // there are several kinds of relative urls:
        // 1. //foo - replaces everything from the domain on.  foo is a domain name
        // 2. foo - replaces the last part of the path, the whole query and fragment
        // 3. /foo - replaces the the path, the query and fragment
        // 4. ?foo - replace the query and fragment
        // 5. #foo - replace the fragment only

        const absoluteUri = baseUri.clone();
        // we satisfy these conditions by looking for the first part of relativeUri
        // that is not blank and applying defaults to the rest

        let overridden = relativeUri.hasScheme();

        if (overridden) {
            absoluteUri.setRawScheme(relativeUri.getRawScheme());
        } else {
            overridden = relativeUri.hasCredentials();
        }

        if (overridden) {
            absoluteUri.setRawCredentials(relativeUri.getRawCredentials());
        } else {
            overridden = relativeUri.hasDomain();
        }

        if (overridden) {
            absoluteUri.setRawDomain(relativeUri.getRawDomain());
        } else {
            overridden = relativeUri.hasPort();
        }

        const rawPath = relativeUri.getRawPath();
        let simplifiedPath = URI.collapse_dots(rawPath);
        if (overridden) {
            absoluteUri.setPort(relativeUri.getPort());
            simplifiedPath = simplifiedPath
                && simplifiedPath.replace(EXTRA_PARENT_PATHS_RE, '');
        } else {
            overridden = !!rawPath;
            if (overridden) {
                // resolve path properly
                if (simplifiedPath!.charCodeAt(0) !== 0x2f /* / */) {  // path is relative
                    const absRawPath = URI.collapse_dots(absoluteUri.getRawPath() || '')!
                        .replace(EXTRA_PARENT_PATHS_RE, '');
                    const slash = absRawPath.lastIndexOf('/') + 1;
                    const merged = (slash ? absRawPath.substring(0, slash) : '')
                        + URI.collapse_dots(rawPath)!;
                    simplifiedPath = URI.collapse_dots(merged)!
                        .replace(EXTRA_PARENT_PATHS_RE, '');
                }
            } else {
                simplifiedPath = simplifiedPath
                    && simplifiedPath.replace(EXTRA_PARENT_PATHS_RE, '');
                if (simplifiedPath !== rawPath) {
                    absoluteUri.setRawPath(simplifiedPath);
                }
            }
        }

        if (overridden) {
            absoluteUri.setRawPath(simplifiedPath);
        } else {
            overridden = relativeUri.hasQuery();
        }

        if (overridden) {
            absoluteUri.setRawQuery(relativeUri.getRawQuery());
        } else {
            overridden = relativeUri.hasFragment();
        }

        if (overridden) {
            absoluteUri.setRawFragment(relativeUri.getRawFragment());
        }

        return absoluteUri;
    }

    /** Visible for testing. */
    static collapse_dots(path: string | null): string | null {
        if (path === null) { return null; }
        let p = normPath(path);
        // Only /../ left to flatten
        const r = PARENT_DIRECTORY_HANDLER_RE;
        // We replace with $1 which matches a / before the .. because this
        // guarantees that:
        // (1) we have at most 1 / between the adjacent place,
        // (2) always have a slash if there is a preceding path section, and
        // (3) we never turn a relative path into an absolute path.
        for (let q; (q = p.replace(r, '$1')) !== p; p = q) { /* loop */ }
        return p;
    }

    // lightweight string-based api for loadModuleMaker
    static utils = {
        mimeTypeOf(uri: string): string {
            const uriObj = URI.parse(uri);
            const path = uriObj ? uriObj.getPath() : '';
            if (/\.html$/.test(path ?? '')) {
                return 'text/html';
            } else {
                return 'application/javascript';
            }
        },
        resolve(base: string | null, uri: string): string {
            if (base) {
                return URI.resolve(URI.parse(base)!, URI.parse(uri)!).toString();
            } else {
                return '' + uri;
            }
        }
    };
}

function nullIfAbsent(matchPart: string | undefined): string | null {
    return (typeof matchPart === 'string') && (matchPart.length > 0)
        ? matchPart
        : null;
}

function encodeIfExists(unescapedPart: string | null | undefined): string | null {
    if (typeof unescapedPart === 'string') {
        return encodeURIComponent(unescapedPart);
    }
    return null;
}

/**
 * If unescapedPart is non null, then escapes any characters in it that aren't
 * valid characters in a url and also escapes any special characters that
 * appear in extra.
 *
 * @param extra a character set of characters in [\01-\177].
 * @return null iff unescapedPart == null.
 */
function encodeIfExists2(
    unescapedPart: string | null | undefined,
    extra: RegExp
): string | null {
    if (typeof unescapedPart === 'string') {
        return encodeURI(unescapedPart).replace(extra, encodeOne);
    }
    return null;
}

/** Converts a character in [\01-\177] to its url encoded equivalent. */
function encodeOne(ch: string): string {
    const n = ch.charCodeAt(0);
    return '%' + '0123456789ABCDEF'.charAt((n >> 4) & 0xf) +
        '0123456789ABCDEF'.charAt(n & 0xf);
}

/** Collapses . and / sequences. */
function normPath(path: string): string {
    return path.replace(/(^|\/)\.(?:\/|$)/g, '$1').replace(/\/{2,}/g, '/');
}

const PARENT_DIRECTORY_HANDLER = new RegExp(
    ''
        // A path break
        + '(/|^)'
        // followed by a non .. path element
        // (cannot be . because normPath is used prior to this RegExp)
        + '(?:[^./][^/]*|\\.{2,}(?:[^./][^/]*)|\\.{3,}[^/]*)'
        // followed by .. followed by a path break.
        + '/\\.\\.(?:/|$)');

const PARENT_DIRECTORY_HANDLER_RE = new RegExp(PARENT_DIRECTORY_HANDLER);

const EXTRA_PARENT_PATHS_RE = /^(?:\.\.\/)*(?:\.\.$)?/;

/**
 * A regular expression for breaking a URI into its component parts.
 *
 * <p>The following line is the regular expression for breaking-down a
 * well-formed URI reference into its components.
 *
 * <pre>
 * ^(([^:/?#]+):)?(//([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?
 *  12            3  4          5       6  7        8 9
 * </pre>
 *
 * <p>The modified version yields
 * <pre>
 *    $1 = http              scheme
 *    $2 = <undefined>       credentials -\
 *    $3 = www.ics.uci.edu   domain       | authority
 *    $4 = <undefined>       port        -/
 *    $5 = /pub/ietf/uri/    path
 *    $6 = <undefined>       query without ?
 *    $7 = Related           fragment without #
 * </pre>
 */
const URI_RE_ = new RegExp(
    "^" +
        "(?:" +
        "([^:/?#]+)" +         // scheme
        ":)?" +
        "(?://" +
        "(?:([^/?#]*)@)?" +    // credentials
        "([^/?#:@]*)" +        // domain
        "(?::([0-9]+))?" +     // port
        ")?" +
        "([^?#]+)?" +            // path
        "(?:\\?([^#]*))?" +      // query
        "(?:#(.*))?" +           // fragment
        "$"
);

const URI_DISALLOWED_IN_SCHEME_OR_CREDENTIALS_ = /[#\/\?@]/g;
const URI_DISALLOWED_IN_PATH_ = /[\#\?]/g;

export default URI;
