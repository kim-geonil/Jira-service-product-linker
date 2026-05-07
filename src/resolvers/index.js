import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

const FIELD_CUSTOMER = 'customfield_10087';
const FIELD_SERIAL   = 'customfield_10100';
const FIELD_HOSTNAME = 'customfield_10102';
const FIELD_ALIAS    = 'customfield_10597';
const FIELD_STATUS   = 'customfield_10596';

/** Jira issue link type name used for service product links (same as UI / createLinks). */
const PRODUCT_LINK_TYPE = '제품 링크 (migrated)';
const WORK_LINK_TYPE = '업무 연결';
const WORK_LINK_OUTWARD_LABEL = '업무를 참조함';
const CUSTOMER_LINK_TYPE = '고객사 링크';
const CUSTOMER_LINK_OUTWARD_LABEL = '연결된 Deal';

function normalizeLinkLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeJqlString(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Collects human-readable customer names from a Jira custom field value into a Set.
 * Handles string, array of strings/objects, and single select-style objects.
 * Used when scanning many Deal issues for the autocomplete list.
 *
 * @param {unknown} c - Raw value from issue.fields[FIELD_CUSTOMER]
 * @param {Set<string>} outSet - Set to add names into
 */
function collectCustomerNamesFromFieldValue(c, outSet) {
    if (c == null) return;
    if (typeof c === 'string') {
        outSet.add(c);
        return;
    }
    if (Array.isArray(c)) {
        c.forEach(item => {
            if (typeof item === 'string') outSet.add(item);
            else if (item && typeof item === 'object') {
                if (item.value) outSet.add(item.value);
                else if (item.name) outSet.add(item.name);
            }
        });
        return;
    }
    if (typeof c === 'object') {
        if (c.value) outSet.add(c.value);
        else if (c.name) outSet.add(c.name);
    }
}

/**
 * Returns a single customer name for the current issue (for pre-filling the picker).
 * Mirrors previous getIssueInfo behavior and extends array fields to use the first entry.
 *
 * @param {unknown} c - Raw value from issue.fields[FIELD_CUSTOMER]
 * @returns {string|null}
 */
function getPrimaryCustomerNameForIssue(c) {
    if (c == null) return null;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
        for (const item of c) {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object') {
                if (item.value) return item.value;
                if (item.name) return item.name;
            }
        }
        return null;
    }
    if (typeof c === 'object') {
        if (c.value) return c.value;
        if (c.name) return c.name;
    }
    return null;
}

/**
 * Product issue keys from issuelinks for links created by this app.
 *
 * @param {Array<{ type?: { name?: string }, outwardIssue?: { key?: string }, inwardIssue?: { key?: string } }>} issuelinks
 * @returns {string[]}
 */
function extractProductKeysFromIssueLinks(issuelinks) {
    return (issuelinks || [])
        .filter(l => normalizeLinkLabel(l.type?.name) === PRODUCT_LINK_TYPE)
        .map(l => l.outwardIssue?.key || l.inwardIssue?.key)
        .filter(Boolean);
}

/**
 * Linked issue keys shown under a Deal's product list. This intentionally includes
 * old Jira work links whose outward label is displayed as "업무를 참조함".
 *
 * @param {Array<{ type?: { name?: string, outward?: string }, outwardIssue?: { key?: string }, inwardIssue?: { key?: string } }>} issuelinks
 * @returns {string[]}
 */
function extractDealLinkedIssueKeysFromIssueLinks(issuelinks) {
    const keys = (issuelinks || [])
        .filter(l => {
            const typeName = normalizeLinkLabel(l.type?.name);
            const outwardLabel = normalizeLinkLabel(l.type?.outward);
            return typeName === PRODUCT_LINK_TYPE ||
                (typeName === WORK_LINK_TYPE && outwardLabel === WORK_LINK_OUTWARD_LABEL);
        })
        .map(l => l.outwardIssue?.key || l.inwardIssue?.key)
        .filter(Boolean);

    return [...new Set(keys)];
}

/**
 * Deal keys already linked from the current issue under the "연결된 Deal" relationship.
 *
 * @param {Array<{ type?: { name?: string, outward?: string }, outwardIssue?: { key?: string } }>} issuelinks
 * @returns {string[]}
 */
function extractLinkedDealKeysFromIssueLinks(issuelinks) {
    return (issuelinks || [])
        .filter(l =>
            normalizeLinkLabel(l.type?.name) === CUSTOMER_LINK_TYPE &&
            normalizeLinkLabel(l.type?.outward) === CUSTOMER_LINK_OUTWARD_LABEL
        )
        .map(l => l.outwardIssue?.key)
        .filter(Boolean);
}

// 1. 고객사 목록 조회 (Deal 기준)
resolver.define('getCustomers', async ({ payload } = {}) => {
    try {
        const { projectKey } = payload || {};
        if (!projectKey) {
            console.error('getCustomers error: projectKey is required');
            return [];
        }
        const safeProjectKey = escapeJqlString(projectKey);
        const response = await api.asUser().requestJira(
            route`/rest/api/3/search/jql`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // pre-sales, post-sales 둘 다
                    jql: `project = "${safeProjectKey}" AND issuetype = "Deal (migrated)" AND status in ("pre-sales", "post-sales")`,
                    maxResults: 500,
                    fields: [FIELD_CUSTOMER]
                })
            }
        );
        const data = await response.json();

        const issues = data.issues || [];
        const customers = new Set();
        issues.forEach(i => {
            collectCustomerNamesFromFieldValue(i.fields[FIELD_CUSTOMER], customers);
        });

        console.log('최종 고객사 목록:', JSON.stringify([...customers]));
        return [...customers].sort();
    } catch (e) {
        console.error('getCustomers error:', e.message);
        return [];
    }
});

// 2. 선택한 고객사의 Deal 목록 (pre-sales, post-sales)
resolver.define('getDeals', async ({ payload }) => {
    try {
        const { customer, projectKey } = payload || {};
        if (!customer || !projectKey) {
            console.error('getDeals error: customer and projectKey are required');
            return [];
        }
        const safeCustomer = escapeJqlString(customer);
        const safeProjectKey = escapeJqlString(projectKey);
        const response = await api.asUser().requestJira(
            route`/rest/api/3/search/jql`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    // pre-sales, post-sales 둘 다
                    jql: `project = "${safeProjectKey}" AND issuetype = "Deal (migrated)" AND status in ("pre-sales", "post-sales") AND ${FIELD_CUSTOMER} = "${safeCustomer}" ORDER BY summary ASC`,
                    maxResults: 100,
                    fields: ['summary', FIELD_CUSTOMER, 'status']
                })
            }
        );
        const data = await response.json();
        console.log('getDeals:', JSON.stringify(data).substring(0, 300));

        const issues = data.issues || [];
        return issues.map(i => ({
            key:     i.key,
            summary: i.fields.summary || '-',
            status:  i.fields.status?.name || '-'
        }));
    } catch (e) {
        console.error('getDeals error:', e.message);
        return [];
    }
});

// 3. Deal에 연결된 장비 목록
resolver.define('getDealProducts', async ({ payload }) => {
    try {
        const { dealKey } = payload;
        const response = await api.asUser().requestJira(
            route`/rest/api/3/issue/${dealKey}?fields=issuelinks`
        );
        const data = await response.json();

        const issuelinks = data.fields?.issuelinks || [];

        const productKeys = extractDealLinkedIssueKeysFromIssueLinks(issuelinks);

        console.log('productKeys:', productKeys);

        // 장비 없어도 빈 배열 반환 (에러 아님)
        if (productKeys.length === 0) return [];

        const prodResponse = await api.asUser().requestJira(
            route`/rest/api/3/search/jql`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jql: `key in (${productKeys.join(',')})`,
                    maxResults: 200,
                    fields: ['summary', FIELD_SERIAL, FIELD_HOSTNAME, FIELD_ALIAS, FIELD_CUSTOMER]
                })
            }
        );
        const prodData = await prodResponse.json();
        const prodIssues = prodData.issues || [];

        return prodIssues.map(i => {
            const c = i.fields[FIELD_CUSTOMER];
            let customerName = '-';
            if (typeof c === 'string') customerName = c;
            else if (c?.value) customerName = c.value;
            else if (c?.name)  customerName = c.name;

            return {
                key:      i.key,
                summary:  i.fields.summary || '-',
                customer: customerName,
                serial:   i.fields[FIELD_SERIAL]   || '-',
                hostname: i.fields[FIELD_HOSTNAME] || '-',
                alias:    i.fields[FIELD_ALIAS]    || '-',
            };
        });
    } catch (e) {
        console.error('getDealProducts error:', e.message);
        return [];
    }
});

/**
 * Single Jira GET for issue panel bootstrap: linked product keys + customer + project.
 * Replaces separate getLinkedProducts + getIssueInfo calls (one Jira round-trip).
 */
resolver.define('getIssueBootstrap', async ({ payload }) => {
    try {
        const { issueKey } = payload;
        const response = await api.asUser().requestJira(
            route`/rest/api/3/issue/${issueKey}?fields=issuelinks,${FIELD_CUSTOMER},project`
        );
        const data = await response.json();
        const issuelinks = data.fields?.issuelinks || [];
        const linkedKeys = extractProductKeysFromIssueLinks(issuelinks);
        const c = data.fields?.[FIELD_CUSTOMER];
        const customer = getPrimaryCustomerNameForIssue(c);

        return {
            linkedKeys,
            issueInfo: {
                customer,
                projectKey:  data.fields?.project?.key  ?? null,
                projectName: data.fields?.project?.name ?? null
            }
        };
    } catch (e) {
        console.error('getIssueBootstrap error:', e.message);
        return {
            linkedKeys: [],
            issueInfo: { customer: null, projectKey: null, projectName: null }
        };
    }
});

// 4. 링크 일괄 생성
resolver.define('createLinks', async ({ payload }) => {
    const { issueKey, dealKeys, dealKey, productKeys } = payload;
    /** 구 클라이언트(dealKey 단일)와 신규(dealKeys 배열) 모두 지원합니다. */
    const dealKeysList = [
        ...new Set([
            ...(Array.isArray(dealKeys) ? dealKeys : []),
            ...(dealKey ? [dealKey] : [])
        ])
    ].filter(Boolean);
    console.log('createLinks payload:', JSON.stringify({ issueKey, dealKeys: dealKeysList, productKeys }));

    const currentIssueResponse = await api.asUser().requestJira(
        route`/rest/api/3/issue/${issueKey}?fields=issuelinks`
    );
    const currentIssueData = await currentIssueResponse.json();
    const currentIssueLinks = currentIssueData.fields?.issuelinks || [];
    const existingProductKeys = new Set(extractProductKeysFromIssueLinks(currentIssueLinks));
    /** 같은 요청 안에서 앞선 Deal 링크 성공 후 중복 POST를 막기 위해 갱신합니다. */
    const existingDealKeys = new Set(extractLinkedDealKeysFromIssueLinks(currentIssueLinks));
    console.log('createLinks existing links:', JSON.stringify({
        existingProductKeys: [...existingProductKeys],
        existingDealKeys: [...existingDealKeys]
    }));

    const dealResults = [];
    for (const dk of dealKeysList) {
        if (existingDealKeys.has(dk)) {
            console.log('createDealLink skipped: already linked', JSON.stringify({ issueKey, dealKey: dk }));
            dealResults.push({ key: dk, success: true, alreadyLinked: true });
            continue;
        }
        try {
            const response = await api.asUser().requestJira(
                route`/rest/api/3/issueLink`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type:         { name: CUSTOMER_LINK_TYPE },
                        inwardIssue:  { key: issueKey },
                        outwardIssue: { key: dk }
                    })
                }
            );
            const responseBody = await response.text();
            console.log('createDealLink result:', JSON.stringify({
                issueKey,
                dealKey: dk,
                status: response.status,
                ok: response.ok,
                body: responseBody
            }));
            const dr = {
                key: dk,
                success: response.ok,
                status: response.status,
                error: response.ok ? undefined : responseBody
            };
            dealResults.push(dr);
            if (response.ok) {
                existingDealKeys.add(dk);
            }
        } catch (e) {
            console.error('createDealLink error:', e.message);
            dealResults.push({ key: dk, success: false, error: e.message });
        }
    }
    if (dealKeysList.length === 0) {
        console.log('createDealLink skipped: no dealKeys', JSON.stringify({ issueKey }));
    }

    const results = [];
    for (const productKey of [...new Set(productKeys || [])]) {
        if (existingProductKeys.has(productKey)) {
            results.push({ key: productKey, success: true, alreadyLinked: true });
            continue;
        }
        try {
            const response = await api.asUser().requestJira(
                route`/rest/api/3/issueLink`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type:         { name: PRODUCT_LINK_TYPE },
                        inwardIssue:  { key: issueKey },
                        outwardIssue: { key: productKey }
                    })
                }
            );
            results.push({ key: productKey, success: response.ok });
        } catch (e) {
            results.push({ key: productKey, success: false, error: e.message });
        }
    }
    return { productResults: results, dealResults };
});

export const handler = resolver.getDefinitions();
