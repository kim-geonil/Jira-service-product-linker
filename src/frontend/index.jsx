import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view } from '@forge/bridge';

function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
        <>
            {text.slice(0, idx)}
            <strong style={{ color: '#0052cc' }}>{text.slice(idx, idx + query.length)}</strong>
            {text.slice(idx + query.length)}
        </>
    );
}

function Spinner({ text = '로딩 중...' }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '10px' }}>
            <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                role="img"
                aria-label={text}
                style={{ flexShrink: 0 }}
            >
                <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="#e0e0e0"
                    strokeWidth="3"
                />
                <path
                    d="M10 2a8 8 0 0 1 8 8"
                    fill="none"
                    stroke="#0052cc"
                    strokeWidth="3"
                    strokeLinecap="round"
                >
                    <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0 10 10"
                        to="360 10 10"
                        dur="0.8s"
                        repeatCount="indefinite"
                    />
                </path>
            </svg>
            <span style={{ color: '#6b778c', fontSize: '12px' }}>{text}</span>
        </div>
    );
}

const MIN_JQL_QUERY_LENGTH = 2;
const JQL_SEARCH_DEBOUNCE_MS = 500;
const TEXT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

function App() {
    const [issueKey, setIssueKey]               = useState('');
    const [projectKey, setProjectKey]           = useState('');
    const [customers, setCustomers]             = useState([]);
    const [customerInput, setCustomerInput]     = useState('');
    const [showDropdown, setShowDropdown]       = useState(false);
    const [selCustomer, setSelCustomer]         = useState('');
    const [deals, setDeals]                     = useState([]);
    const [selDeal, setSelDeal]                 = useState(null);
    const [products, setProducts]               = useState([]);
    const [productSearch, setProductSearch]     = useState('');
    const [textMatchedProductKeys, setTextMatchedProductKeys] = useState(new Set());
    const [textSearchLoading, setTextSearchLoading] = useState(false);
    const [textSearchError, setTextSearchError] = useState('');
    const [dealLoaded, setDealLoaded]           = useState(false);
    const [checked, setChecked]                 = useState(new Map());
    const [linked, setLinked]                   = useState(new Set());
    const [initialLoading, setInitialLoading]   = useState(true);
    /** 고객사 전체 목록만 별도 로드 — 패널 본문은 이 값과 무관하게 먼저 표시 */
    const [customersLoading, setCustomersLoading] = useState(false);
    const [loadingDeals, setLoadingDeals]       = useState(false);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [linking, setLinking]                 = useState(false);
    const [message, setMessage]                 = useState('');
    const dropdownRef = useRef(null);
    const textSearchSeqRef = useRef(0);
    const textSearchCacheRef = useRef(new Map());

    const filteredCustomers = customerInput.trim() === ''
        ? customers
        : customers.filter(c =>
            c.toLowerCase().includes(customerInput.toLowerCase())
        );

    // 초기 로드: 이슈 필수 데이터 먼저(한 번의 Jira GET), 고객사 목록은 지연 로드
    useEffect(() => {
        let cancelled = false;
        view.getContext().then(async ctx => {
            const key = ctx.extension.issue.key;
            let bootstrapProjectKey = null;
            setIssueKey(key);
            try {
                const boot = await invoke('getIssueBootstrap', { issueKey: key });
                if (cancelled) return;
                setLinked(new Set(boot.linkedKeys || []));
                const info = boot.issueInfo || {};
                if (info.projectKey) {
                    bootstrapProjectKey = info.projectKey;
                    setProjectKey(info.projectKey);
                }
                if (info.customer) {
                    setSelCustomer(info.customer);
                    setCustomerInput(info.customer);
                }
            } catch (e) {
                if (!cancelled) {
                    setLinked(new Set());
                }
            } finally {
                if (!cancelled) setInitialLoading(false);
            }

            // 고객사 자동완성 목록은 무거울 수 있어 별도 호출
            if (!cancelled) setCustomersLoading(true);
            try {
                const customerList = await invoke('getCustomers', { projectKey: bootstrapProjectKey });
                if (!cancelled) setCustomers(customerList || []);
            } catch (e) {
                if (!cancelled) setCustomers([]);
            } finally {
                if (!cancelled) setCustomersLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, []);

    // 외부 클릭 시 드롭다운 닫기
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleKeyboardAction = (e, action) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            action();
        }
    };

    // 고객사 선택 시 Deal 목록 로드
    useEffect(() => {
        if (!selCustomer || !projectKey) {
            setDeals([]);
            setSelDeal(null);
            setProducts([]);
            setProductSearch('');
            textSearchSeqRef.current += 1;
            setTextMatchedProductKeys(new Set());
            setTextSearchLoading(false);
            setTextSearchError('');
            setDealLoaded(false);
            return;
        }
        setLoadingDeals(true);
        setDeals([]);
        setSelDeal(null);
        setProducts([]);
        setProductSearch('');
        textSearchSeqRef.current += 1;
        setTextMatchedProductKeys(new Set());
        setTextSearchLoading(false);
        setTextSearchError('');
        setDealLoaded(false);
        invoke('getDeals', { customer: selCustomer, projectKey })
            .then(data => {
                setDeals(data);
                setLoadingDeals(false);
            })
            .catch(() => setLoadingDeals(false));
    }, [selCustomer, projectKey]);

    const handleCustomerInput = (e) => {
        const val = e.target.value;
        setCustomerInput(val);
        setShowDropdown(true);
        if (val === '') setSelCustomer('');
    };

    const handleCustomerSelect = (customer) => {
        setSelCustomer(customer);
        setCustomerInput(customer);
        setShowDropdown(false);
    };

    const handleDealClick = async (deal) => {
        if (selDeal?.key === deal.key) return;
        setSelDeal(deal);
        setProductSearch('');
        textSearchSeqRef.current += 1;
        setTextMatchedProductKeys(new Set());
        setTextSearchLoading(false);
        setTextSearchError('');
        setLoadingProducts(true);
        setProducts([]);
        setDealLoaded(false);
        try {
            const data = await invoke('getDealProducts', { dealKey: deal.key });
            setProducts(data);
            setDealLoaded(true);
        } catch (e) {
            setProducts([]);
            setDealLoaded(true);
        } finally {
            setLoadingProducts(false);
        }
    };

    const productKeys = useMemo(
        () => products.map(product => product.key).filter(Boolean),
        [products]
    );

    useEffect(() => {
        const query = productSearch.trim();
        const normalizedQuery = query.toLowerCase();

        if (query.length < MIN_JQL_QUERY_LENGTH || productKeys.length === 0) {
            textSearchSeqRef.current += 1;
            setTextMatchedProductKeys(new Set());
            setTextSearchLoading(false);
            setTextSearchError('');
            return;
        }

        const cacheKey = `${normalizedQuery}::${productKeys.join(',')}`;
        const cached = textSearchCacheRef.current.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < TEXT_SEARCH_CACHE_TTL_MS) {
            textSearchSeqRef.current += 1;
            setTextMatchedProductKeys(new Set(cached.keys));
            setTextSearchLoading(false);
            setTextSearchError('');
            return;
        }

        const seq = ++textSearchSeqRef.current;
        setTextMatchedProductKeys(new Set());
        setTextSearchLoading(true);
        setTextSearchError('');

        const timeoutId = setTimeout(async () => {
            try {
                const result = await invoke('searchProductsByText', {
                    productKeys,
                    query
                });
                if (seq !== textSearchSeqRef.current) return;

                const keys = Array.isArray(result?.keys) ? result.keys : [];
                textSearchCacheRef.current.set(cacheKey, {
                    keys,
                    cachedAt: Date.now()
                });
                setTextMatchedProductKeys(new Set(keys));
                setTextSearchError(result?.error
                    ? '상세 내용 검색에 실패했습니다. 기본 필드 검색 결과만 표시합니다.'
                    : '');
            } catch (e) {
                if (seq !== textSearchSeqRef.current) return;
                setTextMatchedProductKeys(new Set());
                setTextSearchError('상세 내용 검색에 실패했습니다. 기본 필드 검색 결과만 표시합니다.');
            } finally {
                if (seq === textSearchSeqRef.current) {
                    setTextSearchLoading(false);
                }
            }
        }, JQL_SEARCH_DEBOUNCE_MS);

        return () => clearTimeout(timeoutId);
    }, [productSearch, productKeys]);

    /** 선택된 제품은 어느 Deal에서 골랐는지 함께 저장해서 링크 생성 시 여러 Deal을 연결합니다. */
    const buildSelectedProductEntry = (product) => ({
        key: product.key,
        summary: product.summary,
        serial: product.serial,
        hostname: product.hostname,
        alias: product.alias,
        customer: product.customer,
        dealKey: selDeal?.key ?? null,
        dealSummary: selDeal?.summary ?? null
    });

    const toggleCheck = (product) => {
        if (linked.has(product.key)) return;
        setChecked(prev => {
            const next = new Map(prev);
            if (next.has(product.key)) {
                next.delete(product.key);
                return next;
            }
            if (!selDeal) return prev;
            next.set(product.key, buildSelectedProductEntry(product));
            return next;
        });
    };

    const toggleAll = () => {
        setChecked(prev => {
            const next = new Map(prev);
            if (visibleAllChecked) {
                visibleSelectableProducts.forEach(p => next.delete(p.key));
                return next;
            }
            if (!selDeal) return prev;
            visibleSelectableProducts.forEach(p => next.set(p.key, buildSelectedProductEntry(p)));
            return next;
        });
    };

    /** 이슈 액션 오버레이 닫기 (@forge/bridge `view.close`). */
    const handleClose = () => {
        view.close().catch((err) => {
            console.warn('view.close failed:', err);
        });
    };

    const createLinks = async () => {
        if (checked.size === 0) return;
        setLinking(true);
        setMessage('');
        const selectedProducts = [...checked.values()];
        const productKeys = [...checked.keys()];
        const dealKeys = [...new Set(selectedProducts.map(p => p.dealKey).filter(Boolean))];
        const res = await invoke('createLinks', { issueKey, dealKeys, productKeys });
        const productResults = Array.isArray(res) ? res : (res.productResults || []);
        const dealResultsRaw = Array.isArray(res)
            ? []
            : (Array.isArray(res.dealResults)
                ? res.dealResults
                : (res.dealResult != null ? [res.dealResult] : []));
        const dealResults = Array.isArray(dealResultsRaw) ? dealResultsRaw : [];
        const productSuccess = productResults.filter(r => r.success);
        const productCreated = productSuccess.filter(r => !r.alreadyLinked).length;
        const productAlready = productSuccess.filter(r => r.alreadyLinked).length;
        const productFail = productResults.filter(r => !r.success).length;
        const dealSuccess = dealResults.filter(r => r && r.success);
        const dealCreated = dealSuccess.filter(r => !r.alreadyLinked).length;
        const dealAlready = dealSuccess.filter(r => r.alreadyLinked).length;
        const dealFail = dealResults.filter(r => r && !r.success).length;
        setLinked(prev => {
            const next = new Set(prev);
            productSuccess.forEach(r => next.add(r.key));
            return next;
        });
        setChecked(prev => {
            const next = new Map(prev);
            productSuccess.forEach(r => next.delete(r.key));
            return next;
        });
        const messageParts = [];
        if (productCreated > 0) messageParts.push(`✅ 제품 ${productCreated}개 연결`);
        if (productAlready > 0) messageParts.push(`이미 연결된 제품 ${productAlready}개`);
        if (dealCreated > 0) messageParts.push(`✅ Deal ${dealCreated}개 연결`);
        if (dealAlready > 0) messageParts.push(`이미 연결된 Deal ${dealAlready}개`);
        if (productFail > 0 || dealFail > 0) {
            messageParts.push(`⚠️ 실패 ${productFail + dealFail}개`);
        }
        setMessage(messageParts.join(' / ') || '처리할 항목이 없습니다.');
        if (productSuccess.length > 0 || dealSuccess.length > 0) {
            try {
                await view.refresh();
            } catch (e) {
                console.warn('Issue view refresh failed:', e);
            }
        }
        setLinking(false);
    };

    const normalizedProductSearch = productSearch.trim().toLowerCase();
    const productsWithSearchText = useMemo(() => products.map(product => ({
        ...product,
        localSearchText: [
            product.alias,
            product.summary,
            product.key,
            product.serial,
            product.hostname
        ].filter(Boolean).join(' ').toLowerCase()
    })), [products]);
    const filteredProducts = normalizedProductSearch === ''
        ? products
        : productsWithSearchText.filter(p =>
            p.localSearchText.includes(normalizedProductSearch) ||
            textMatchedProductKeys.has(p.key)
        );
    const visibleSelectableProducts = filteredProducts.filter(p => !linked.has(p.key));
    const visibleSelectableCount = visibleSelectableProducts.length;
    const visibleAllChecked = visibleSelectableCount > 0 &&
        visibleSelectableProducts.every(p => checked.has(p.key));
    const productSearchActive = normalizedProductSearch !== '';
    const currentStep = selDeal ? 3 : selCustomer ? 2 : 1;
    const footerHelp = linking
        ? '현재 이슈에 링크를 생성하고 있습니다.'
        : checked.size > 0
            ? `선택한 장비 ${checked.size}개가 현재 이슈에 연결됩니다.`
            : '장비를 선택하면 링크를 생성할 수 있습니다.';

    const S = {
        wrap:        {
            padding: '20px',
            fontFamily: '-apple-system, sans-serif',
            fontSize: '13px',
            width: '100%',            // ✅ 변경
            boxSizing: 'border-box',  // ✅ 추가
            overflowX: 'hidden',      // ✅ 추가
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column'
        },
        title:       { fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#172b4d', borderBottom: '2px solid #0052cc', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        main:        { flex: 1 },
        stepBar:     { display: 'flex', gap: '8px', marginBottom: '16px' },
        stepItem:    (active, done) => ({ flex: 1, padding: '8px 10px', borderRadius: '4px', border: `1px solid ${active || done ? '#0052cc' : '#dfe1e6'}`, background: active ? '#deebff' : done ? '#f0f4ff' : 'white', color: active || done ? '#0052cc' : '#6b778c', fontSize: '12px', fontWeight: active ? '700' : '500' }),
        label:       { fontSize: '11px', color: '#6b778c', marginBottom: '4px', display: 'block', fontWeight: '500' },
        input:       { width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '13px', boxSizing: 'border-box', marginBottom: '4px' },
        dropdown:    { border: '1px solid #ccc', borderRadius: '4px', background: 'white', maxHeight: '220px', overflowY: 'auto', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' },
        dropItem:    (active) => ({ padding: '9px 12px', cursor: 'pointer', background: active ? '#deebff' : 'white', fontSize: '12px', borderBottom: '1px solid #f0f0f0' }),
        dealList:    { border: '1px solid #e0e0e0', borderRadius: '4px', marginBottom: '16px', maxHeight: '220px', overflowY: 'auto' },
        dealRow:     (selected) => ({ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: selected ? '#deebff' : 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }),
        prodSearch:  { marginBottom: '8px' },
        resultText:  { fontSize: '12px', color: '#6b778c', marginTop: '4px' },
        prodBox:     { border: '1px solid #e0e0e0', borderRadius: '4px', marginBottom: '16px', maxHeight: '320px', overflowY: 'auto' },
        prodHead:    { padding: '10px 12px', background: '#f4f5f7', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0 },
        prodRow:     (isLinked, isChecked) => ({ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '10px', background: isLinked ? '#f0fff4' : isChecked ? '#f0f4ff' : 'white', cursor: isLinked ? 'default' : 'pointer' }),
        selectedBox: { border: '1px solid #0052cc', borderRadius: '4px', marginBottom: '16px', maxHeight: '160px', overflowY: 'auto', background: '#f0f4ff' },
        selectedHead:{ padding: '8px 12px', background: '#deebff', borderBottom: '1px solid #0052cc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        selectedRow: { padding: '8px 12px', borderBottom: '1px solid #dce5ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        emptyGuide:  { padding: '24px', border: '1px dashed #dfe1e6', borderRadius: '4px', background: '#fafbfc', color: '#42526e', textAlign: 'center', marginTop: '16px' },
        footer:      { position: 'sticky', bottom: 0, display: 'flex', gap: '16px', alignItems: 'center', justifyContent: 'space-between', paddingTop: '12px', marginTop: '20px', borderTop: '1px solid #dfe1e6', background: 'white' },
        footerHelp:  { fontSize: '12px', color: '#6b778c' },
        actionRow:   { display: 'flex', gap: '10px', alignItems: 'stretch', justifyContent: 'flex-end' },
        btnCancel:   { flexShrink: 0, padding: '11px 16px', background: 'white', color: '#42526e', border: '1px solid #dfe1e6', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
        btnLink:     (active) => ({ minWidth: '132px', padding: '11px 16px', background: active ? '#0f6e56' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: active ? 'pointer' : 'default', fontSize: '13px', fontWeight: '600' }),
        btnSmall:    { fontSize: '11px', padding: '2px 8px', border: '1px solid #de350b', borderRadius: '3px', cursor: 'pointer', background: 'white', color: '#de350b' },
        subText:     { fontSize: '11px', color: '#6b778c', marginTop: '2px' },
        message:     { fontSize: '12px', padding: '10px 12px', borderRadius: '4px', marginBottom: '12px', background: '#e3fcef', color: '#0f6e56', border: '1px solid #abf5d1' },
        noData:      { padding: '20px', textAlign: 'center', color: '#6b778c', fontSize: '12px' },
        badge:       (color) => ({ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', marginLeft: '6px', background: color === 'green' ? '#e3fcef' : color === 'blue' ? '#deebff' : '#f4f5f7', color: color === 'green' ? '#0f6e56' : color === 'blue' ? '#0052cc' : '#6b778c', fontWeight: '500' }),
        statusBadge: (status) => { const isPost = status?.toLowerCase() === 'post-sales'; return { fontSize: '10px', padding: '2px 8px', borderRadius: '3px', background: isPost ? '#e3fcef' : '#fff7d6', color: isPost ? '#0f6e56' : '#974f0c', fontWeight: '500', whiteSpace: 'nowrap' }; }
    };

    if (initialLoading) {
        return (
            <div style={{ ...S.wrap, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', gap: '16px' }}>
                <Spinner text="데이터 로딩 중..." />
                <button type="button" style={S.btnCancel} onClick={handleClose}>
                    취소
                </button>
            </div>
        );
    }

    return (
        <div style={S.wrap}>
            <main style={S.main}>
                <div style={S.title}>
                    <span>🔗 서비스 제품 연결</span>
                    <span style={{ fontSize: '12px', color: '#6b778c', fontWeight: '400' }}>{issueKey}</span>
                </div>

                <div style={S.stepBar}>
                    {['고객사 선택', 'Deal 선택', '장비 선택'].map((label, index) => {
                        const step = index + 1;
                        const done = currentStep > step;
                        const active = currentStep === step;
                        return (
                            <div key={label} style={S.stepItem(active, done)}>
                                {done ? '✓' : step}. {label}
                            </div>
                        );
                    })}
                </div>

                {/* 고객사 자동완성 */}
                <label style={S.label}>
                    고객사 검색 ({customersLoading ? '목록 로딩 중…' : `${customers.length}개`})
                </label>
                <div ref={dropdownRef}>
                    <input
                        style={S.input}
                        type="text"
                        placeholder={customersLoading ? '고객사 목록 불러오는 중…' : '고객사명 입력 또는 클릭하여 전체 목록 보기...'}
                        value={customerInput}
                        onChange={handleCustomerInput}
                        onFocus={() => setShowDropdown(true)}
                    />
                    {showDropdown && (
                        <div style={S.dropdown}>
                            {customersLoading && customers.length === 0 ? (
                                <div style={{ padding: '10px 12px', color: '#6b778c', fontSize: '12px' }}>
                                    고객사 목록 불러오는 중…
                                </div>
                            ) : filteredCustomers.length === 0 ? (
                                <div style={{ padding: '10px 12px', color: '#6b778c', fontSize: '12px' }}>
                                    검색 결과 없음
                                </div>
                            ) : (
                                filteredCustomers.map(c => (
                                    <div key={c}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={selCustomer === c}
                                        style={S.dropItem(selCustomer === c)}
                                        onMouseDown={() => handleCustomerSelect(c)}
                                        onKeyDown={(e) => handleKeyboardAction(e, () => handleCustomerSelect(c))}>
                                        {customerInput.trim() !== ''
                                            ? highlightMatch(c, customerInput)
                                            : c}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {!selCustomer && (
                    <div style={S.emptyGuide}>
                        <div style={{ fontWeight: '700', marginBottom: '6px' }}>먼저 고객사를 선택하세요</div>
                        <div>고객사를 선택하면 관련 Deal과 장비 목록을 차례로 보여줍니다.</div>
                    </div>
                )}

                {/* Deal 목록 */}
                {selCustomer && (
                    <>
                        <label style={S.label}>
                            Deal 선택 {deals.length > 0 && `(${deals.length}개)`}
                        </label>
                        <div style={S.dealList}>
                            {loadingDeals ? (
                                <Spinner text="Deal 로딩 중..." />
                            ) : deals.length === 0 ? (
                                <div style={S.noData}>Deal이 없습니다.</div>
                            ) : (
                                deals.map(d => (
                                    <div key={d.key}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={selDeal?.key === d.key}
                                        style={S.dealRow(selDeal?.key === d.key)}
                                        onClick={() => handleDealClick(d)}
                                        onKeyDown={(e) => handleKeyboardAction(e, () => handleDealClick(d))}>
                                        <div style={{ flex: 1, overflow: 'hidden' }}>
                                            <div style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {d.summary}
                                            </div>
                                            <div style={S.subText}>{d.key}</div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0, marginLeft: '8px' }}>
                                            <span style={S.statusBadge(d.status)}>{d.status}</span>
                                            {selDeal?.key === d.key && (
                                                <span style={S.badge('blue')}>선택됨</span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                )}

                {/* 장비 목록 */}
                {selDeal && (
                    <>
                        <label style={S.label}>
                            장비 목록: {selDeal.summary}
                            {dealLoaded && ` (${products.length}개)`}
                        </label>
                        {products.length > 0 && (
                            <div style={S.prodSearch}>
                                <input
                                    style={{ ...S.input, marginBottom: 0 }}
                                    type="text"
                                    placeholder="장비명, 시리얼, 호스트명, 이슈 내용으로 검색..."
                                    value={productSearch}
                                    onChange={(e) => setProductSearch(e.target.value)}
                                />
                                <div style={S.resultText}>
                                    {productSearchActive
                                        ? `검색 결과 ${filteredProducts.length}개 / 전체 ${products.length}개`
                                        : `전체 ${products.length}개 중 선택 가능 ${visibleSelectableCount}개`}
                                    {textSearchLoading && ' · 이슈 상세 내용 검색 중...'}
                                    {textSearchError && (
                                        <span style={{ color: '#de350b' }}>
                                            {' · '}{textSearchError}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                        <div style={S.prodBox}>
                            {loadingProducts ? (
                                <Spinner text="장비 로딩 중..." />
                            ) : dealLoaded && products.length === 0 ? (
                                <div style={S.noData}>
                                    이 Deal에 연결된 장비가 없습니다.
                                </div>
                            ) : products.length > 0 ? (
                                <>
                                    <div style={S.prodHead}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                                            <input
                                                type="checkbox"
                                                checked={visibleAllChecked}
                                                onChange={toggleAll}
                                                disabled={visibleSelectableCount === 0}
                                            />
                                            {productSearchActive
                                                ? `검색 결과 선택 (${visibleSelectableCount}개)`
                                                : `전체 선택 (${visibleSelectableCount}개)`}
                                        </label>
                                        <span style={{ fontSize: '12px', color: '#6b778c' }}>
                                            {checked.size > 0 && `누적 선택 ${checked.size}개`}
                                        </span>
                                    </div>
                                    {filteredProducts.length === 0 ? (
                                        <div style={S.noData}>
                                            {textSearchLoading
                                                ? '이슈 상세 내용 검색 중입니다...'
                                                : '검색 조건에 맞는 장비가 없습니다.'}
                                        </div>
                                    ) : (
                                        filteredProducts.map(p => (
                                            <div key={p.key}
                                                role="button"
                                                tabIndex={linked.has(p.key) ? -1 : 0}
                                                aria-disabled={linked.has(p.key)}
                                                aria-pressed={checked.has(p.key)}
                                                style={S.prodRow(linked.has(p.key), checked.has(p.key))}
                                                onClick={() => !linked.has(p.key) && toggleCheck(p)}
                                                onKeyDown={(e) => handleKeyboardAction(e, () => !linked.has(p.key) && toggleCheck(p))}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked.has(p.key)}
                                                    disabled={linked.has(p.key)}
                                                    onChange={() => toggleCheck(p)}
                                                    onClick={e => e.stopPropagation()}
                                                    style={{ flexShrink: 0 }}
                                                />
                                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                                    <div style={{ fontWeight: '500' }}>
                                                        {p.alias !== '-' ? p.alias : p.summary}
                                                        {linked.has(p.key) && (
                                                            <span style={S.badge('green')}>✅ 연결됨</span>
                                                        )}
                                                        {checked.has(p.key) && !linked.has(p.key) && (
                                                            <span style={S.badge('blue')}>선택됨</span>
                                                        )}
                                                    </div>
                                                    <div style={S.subText}>
                                                        SN: {p.serial}
                                                        {p.hostname !== '-' && ` · ${p.hostname}`}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </>
                            ) : null}
                        </div>
                    </>
                )}

                {/* 선택된 장비 요약 */}
                {checked.size > 0 && (
                    <div style={S.selectedBox}>
                        <div style={S.selectedHead}>
                            <span style={{ fontWeight: '600', fontSize: '12px', color: '#0052cc' }}>
                                📋 선택된 장비 ({checked.size}개)
                            </span>
                            <button style={{ fontSize: '12px', color: '#de350b', background: 'none', border: 'none', cursor: 'pointer' }}
                                onClick={() => setChecked(new Map())}>
                                전체 해제
                            </button>
                        </div>
                        {[...checked.values()].map(p => (
                            <div key={p.key} style={S.selectedRow}>
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{ fontWeight: '500', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {p.alias !== '-' ? p.alias : p.summary}
                                    </div>
                                    <div style={S.subText}>
                                        Deal: {p.dealKey || '-'}
                                        {p.dealSummary ? ` · ${p.dealSummary}` : ''}
                                    </div>
                                    <div style={S.subText}>SN: {p.serial}</div>
                                </div>
                                <button style={S.btnSmall} onClick={() => toggleCheck(p)}>
                                    해제
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 메시지 */}
                {message && <div style={S.message}>{message}</div>}
            </main>

            {/* 취소(닫기) + 링크 생성 */}
            <footer style={S.footer}>
                <span style={S.footerHelp}>{footerHelp}</span>
                <div style={S.actionRow}>
                <button
                    type="button"
                    style={{
                        ...S.btnCancel,
                        ...(linking ? { opacity: 0.5, cursor: 'not-allowed' } : {})
                    }}
                    onClick={handleClose}
                    disabled={linking}>
                    취소
                </button>
                <button
                    type="button"
                    style={S.btnLink(checked.size > 0 && !linking)}
                    disabled={checked.size === 0 || linking}
                    onClick={createLinks}>
                    {linking ? '연결 중...' : checked.size > 0 ? `🔗 링크 생성 (${checked.size}개)` : '링크 생성'}
                </button>
                </div>
            </footer>
        </div>
    );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);