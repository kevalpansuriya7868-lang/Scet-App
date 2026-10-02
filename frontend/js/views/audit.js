import { api } from '../api.js';
import { h, fields, modal, toast, fmt, table, badge, rupees } from '../ui.js';

export async function auditTab(code) {
  const wrap = h('div', { class: 'stack' });

  // Filter bar
  const searchInput = h('input', {
    placeholder: '🔍 Search by student, item or admin…',
    class: 'audit-search',
    style: 'max-width:340px',
  });
  const filterSel = h('select', { class: 'audit-filter' },
    h('option', { value: 'all' }, 'All actions'),
    h('option', { value: 'ITEM_ISSUED' }, 'Given (Issued)'),
    h('option', { value: 'ITEM_RETURNED' }, 'Taken (Returned)'),
  );

  const tbody = h('tbody');

  function openAuditDetailModal(r, parsed) {
    const { isIssued, studentName, studentEnrollment, itemsList, qty, conds, details } = parsed;

    // Remaining & fine extraction
    const remMatch = details.match(/remaining:\s*(\d+)/i);
    const remText = remMatch ? (remMatch[1] === '0' ? '0 units left (Complete return)' : `${remMatch[1]} unit(s) remaining`) : '—';
    const fineMatch = details.match(/fine\s+Rs\.?(\d+)/i);
    const fineText = fineMatch ? (Number(fineMatch[1]) > 0 ? `₹${fineMatch[1]} (Overdue penalty)` : '₹0 (No penalty)') : '—';
    const gpMatch = details.match(/(SCET-GP-[A-Z0-9_-]+)/i);
    const proofEmailed = details.includes('proof emailed');
    const daysMatch = details.match(/for\s+(\d+)\s+day/i);

    const body = h('div', { class: 'audit-modal-content stack', style: 'gap:18px;font-size:15px;line-height:1.5' },
      // 1. Top Event Banner
      h('div', {
        class: 'audit-modal-hero',
        style: 'background:linear-gradient(135deg, var(--soft) 0%, #fff 100%);padding:16px 20px;border-radius:14px;border:1.5px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px'
      },
        h('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' },
          isIssued
            ? h('span', { style: 'background:#22c55e;color:#fff;padding:6px 16px;border-radius:99px;font-size:0.95em;font-weight:700;display:inline-flex;align-items:center;gap:6px' }, '⬆ ITEM ISSUED (GIVEN)')
            : h('span', { style: 'background:#f97316;color:#fff;padding:6px 16px;border-radius:99px;font-size:0.95em;font-weight:700;display:inline-flex;align-items:center;gap:6px' }, '⬇ ITEM RETURNED (TAKEN)'),
          h('span', { style: 'font-weight:700;color:var(--ink);font-size:1.05em' }, `Branch: ${r.branchCode || 'CO'}`)
        ),
        h('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' },
          h('span', { style: 'font-size:0.9em;color:var(--muted)' }, `🕒 ${fmt(r.ts)}`),
          h('span', { style: 'background:#e0f2fe;color:#0369a1;padding:4px 10px;border-radius:6px;font-weight:600;font-size:0.85em' }, `Admin: ${r.adminUsername}`)
        )
      ),

      // 2. Info Cards Grid (Student + Transaction Info)
      h('div', {
        class: 'audit-modal-grid',
        style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px'
      },
        // Student Card
        h('div', {
          class: 'card',
          style: 'padding:16px;background:var(--soft);border:1px solid var(--line);border-radius:12px;margin:0'
        },
          h('div', { style: 'font-size:0.75em;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;margin-bottom:6px' }, 'Student Recipient'),
          h('div', { style: 'font-size:1.3em;font-weight:800;color:var(--ink);margin-bottom:6px' }, studentName || studentEnrollment || '—'),
          h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
            h('span', { style: 'font-family:monospace;font-size:0.95em;font-weight:700;background:#fff;padding:3px 9px;border-radius:6px;border:1px solid var(--line);color:var(--ink)' }, studentEnrollment || '—'),
            h('span', { class: 'chip', style: 'font-size:0.78em;padding:2px 8px' }, `Dept ${r.branchCode || 'CO'}`)
          )
        ),

        // Transaction Summary Card
        h('div', {
          class: 'card',
          style: 'padding:16px;background:var(--soft);border:1px solid var(--line);border-radius:12px;margin:0'
        },
          h('div', { style: 'font-size:0.75em;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;margin-bottom:6px' }, 'Transaction Status'),
          h('div', { style: 'display:flex;flex-direction:column;gap:5px;font-size:0.92em' },
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Total Items:'),
              h('strong', {}, `${qty} unit(s)`)
            ),
            isIssued ? h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Issue Duration:'),
              h('strong', {}, daysMatch ? `${daysMatch[1]} day(s)` : 'Standard')
            ) : h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Remaining Items:'),
              h('strong', { style: remText.includes('0') ? 'color:var(--green)' : 'color:var(--warn)' }, remText)
            ),
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, isIssued ? 'Gate Pass:' : 'Penalty / Fine:'),
              h('strong', { style: fineText.includes('Overdue') ? 'color:var(--red)' : '' }, isIssued ? (gpMatch ? gpMatch[1] : 'Generated') : fineText)
            ),
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Email Proof:'),
              h('span', { style: proofEmailed ? 'color:var(--green);font-weight:600' : 'color:var(--muted)' }, proofEmailed ? '✅ Emailed to Student & Admin' : 'None')
            )
          )
        )
      ),

      // 3. Components Breakdown & Conditions Card (Big, Clear List)
      h('div', {
        class: 'card',
        style: 'padding:18px;border:1.5px solid var(--line);border-radius:14px;background:#fff;margin:0'
      },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px' },
          h('h4', { style: 'margin:0;font-size:1.15em;font-weight:800;color:var(--ink)' }, '📦 Components Breakdown'),
          conds.length > 0 && h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
            h('span', { class: 'muted small', style: 'font-size:0.8em;font-weight:600' }, 'Overall Condition:'),
            ...conds.map(c => {
              const cls = c.cond.toLowerCase() === 'working' ? 'ok' : c.cond.toLowerCase() === 'damaged' ? 'warn' : 'bad';
              return h('span', { class: `badge ${cls}`, style: 'font-size:0.85em;padding:3px 10px;font-weight:700' }, `${c.count} ${c.cond}`);
            })
          )
        ),
        itemsList.length === 0
          ? h('p', { class: 'muted' }, 'No detailed component breakdown in log.')
          : h('div', { class: 'tbl-wrap', style: 'border:1px solid #f1f5f9;border-radius:10px' },
              h('table', { style: 'width:100%;font-size:0.95em' },
                h('thead', {},
                  h('tr', {},
                    h('th', { style: 'padding:10px 14px' }, 'Component Name'),
                    h('th', { style: 'padding:10px 14px' }, 'Hardware ID'),
                    h('th', { style: 'padding:10px 14px;text-align:center' }, 'Quantity'),
                    h('th', { style: 'padding:10px 14px' }, isIssued ? 'Status' : 'Return Condition')
                  )
                ),
                h('tbody', {},
                  ...itemsList.map(it => {
                    const itCount = it.qty || '1';
                    let itemCond = it.condition;
                    if (!itemCond) {
                      const cName = conds[0]?.cond || 'Working';
                      itemCond = `${itCount} ${cName}`;
                    } else if (!/^\d+\s+/.test(itemCond)) {
                      itemCond = `${itCount} ${itemCond}`;
                    }
                    const isOk = itemCond.toLowerCase().includes('working');
                    const isWarn = itemCond.toLowerCase().includes('damaged');
                    const cls = isOk ? 'ok' : isWarn ? 'warn' : 'bad';
                    return h('tr', {},
                      h('td', { style: 'font-weight:700;font-size:1.02em;color:var(--ink);padding:12px 14px' }, it.name || it.id),
                      h('td', { style: 'font-family:monospace;color:var(--muted);padding:12px 14px' }, it.id || '—'),
                      h('td', { style: 'text-align:center;font-weight:700;padding:12px 14px' },
                        h('span', { class: 'badge sm info', style: 'font-size:0.85em;padding:2px 8px' }, `×${itCount}`)
                      ),
                      h('td', { style: 'padding:12px 14px' },
                        isIssued
                          ? h('span', { class: 'badge sm ok', style: 'font-size:0.82em' }, 'Issued')
                          : h('span', { class: `badge sm ${cls}`, style: 'font-size:0.85em;padding:3px 9px;font-weight:700' }, itemCond)
                      )
                    );
                  })
                )
              )
            )
      ),

      // 4. Raw Immutable Audit Trail Reference
      h('details', { style: 'font-size:0.85em;background:var(--soft);border-radius:10px;padding:10px 14px;border:1px solid var(--line)' },
        h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--muted)' }, '🔒 Immutable System Log Record (Append-only)'),
        h('div', { style: 'margin-top:8px;font-family:monospace;font-size:0.9em;word-break:break-all;color:var(--ink);background:#fff;padding:10px;border-radius:8px;border:1px solid #e2e8f0;line-height:1.4' }, details)
      )
    );

    modal('📋 Transaction Details', body, [], true);
  }

  // Parse condition counts from details (e.g. "as 8 Working", "as Burnt", "as 1 Working, 1 Damaged")
  function parseConditionCounts(detailsStr, fallbackQty = 1) {
    const m = detailsStr.match(/as\s+([^;]+)/i);
    if (!m) return [];
    const raw = m[1].trim();
    const conds = [];
    const pieces = raw.split(/,\s*/);
    for (const piece of pieces) {
      const pm = piece.match(/^(\d+)\s+(Working|Damaged|Burnt|Lost)$/i);
      if (pm) {
        conds.push({ cond: pm[2], count: parseInt(pm[1], 10) });
      } else {
        const sm = piece.match(/^(Working|Damaged|Burnt|Lost)$/i);
        if (sm) {
          conds.push({ cond: sm[1], count: fallbackQty });
        }
      }
    }
    return conds;
  }

  // Helper to parse individual component item string
  function parseComp(raw, defaultQ = null) {
    raw = (raw || '').trim();
    let itemQty = defaultQ;
    const qm = raw.match(/^(\d+)\s*x\s*(.*)$/i);
    if (qm) {
      itemQty = qm[1];
      raw = qm[2].trim();
    }
    let itemCond = null;
    let id = '', name = raw;
    const allParens = [...raw.matchAll(/\(([^)]+)\)/g)];
    if (allParens.length >= 2) {
      id = allParens[0][1];
      itemCond = allParens[1][1];
      name = raw.slice(0, raw.indexOf('(')).trim();
    } else if (allParens.length === 1) {
      const val = allParens[0][1];
      if (/^(Working|Damaged|Burnt|Lost|\d+\s*(?:Working|Damaged|Burnt|Lost))$/i.test(val)) {
        itemCond = val;
        name = raw.slice(0, raw.indexOf('(')).trim();
      } else {
        id = val;
        name = raw.slice(0, raw.indexOf('(')).trim();
      }
    }
    return { name: name || id, id: id || raw, qty: itemQty, condition: itemCond };
  }

  async function load() {
    const activeBranch = code || 'CO';
    const [rows, branchIssues] = await Promise.all([
      api('/api/audit?limit=500'),
      api(`/api/branches/${activeBranch}/issues`).catch(() => [])
    ]);

    const issuesBySeq = new Map();
    (branchIssues || []).forEach(iss => issuesBySeq.set(iss.seq, iss));

    // Keep only issue/return events
    const issueRows = rows.filter(r =>
      r.action === 'ITEM_ISSUED' || r.action === 'ITEM_RETURNED'
    );

    const q = searchInput.value.trim().toLowerCase();
    const f = filterSel.value;

    const filtered = issueRows.filter(r => {
      if (f !== 'all' && r.action !== f) return false;
      if (!q) return true;
      const hay = `${r.adminUsername} ${r.details || ''} ${r.branchCode || ''}`.toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length === 0) {
      tbody.replaceChildren(
        h('tr', {}, h('td', { colspan: '7', style: 'text-align:center;padding:32px;color:var(--muted)' }, 'No records found.'))
      );
      return;
    }

    tbody.replaceChildren(...filtered.map(r => {
      const isIssued = r.action === 'ITEM_ISSUED';
      const details = r.details || '';

      let studentEnrollment = '', studentName = '';
      let qty = '—';
      let itemsList = [];

      if (isIssued) {
        // e.g. "to ET25BTCO177 (Keval Pansuriya)" or "to ET25BTCO177"
        const sm = details.match(/to\s+([A-Z0-9_-]+)(?:\s*\(([^)]+)\))?/i);
        if (sm) {
          studentEnrollment = sm[1];
          studentName = (sm[2] || '').trim();
        }

        // Multi-item: "Issued [2 x Arduino Nano (COMP-ARD-001), ...] to..."
        const bm = details.match(/Issued\s+\[(.*?)\]\s+to/i);
        if (bm) {
          let totalQty = 0;
          itemsList = bm[1].split(/,\s*(?=[0-9]+\s*x|[A-Z])/i).map(p => {
            const parsed = parseComp(p);
            const n = parseInt(parsed.qty, 10);
            if (!isNaN(n)) totalQty += n;
            return parsed;
          });
          qty = totalQty || '—';
        } else {
          // Single item: "Issued 1 x COMP-ARD-002 to..."
          const m = details.match(/Issued\s+(\d+)\s*x\s*(.*?)\s+to\s+/i);
          if (m) {
            qty = m[1];
            itemsList = [parseComp(m[2], m[1])];
          }
        }
      } else {
        // RETURNED
        // Qty: "Returned 8 unit(s) of [..."
        const qm1 = details.match(/Returned\s+(\d+)\s+of\s+(\d+)/i);
        const qm2 = details.match(/Returned\s+(\d+)\s+unit/i);
        const qm3 = details.match(/x\s+(\d+)\)/i);
        if (qm1) qty = `${qm1[1]} (of ${qm1[2]})`;
        else if (qm2) qty = qm2[1];
        else if (qm3) qty = qm3[1];

        // Student:
        // Try pattern immediately after closing bracket: "...] (ET25BTCO177 - Keval Pansuriya)"
        const sm1 = details.match(/\]\s*\(([A-Z0-9_-]+)(?:\s*[-—]\s*([^)]+))?\)/i);
        const sm2 = details.match(/\(([A-Z0-9_-]+)\s*[-—]\s*([^)]+)\)/i);
        const sm3 = details.match(/issue\s+#\d+\s+\(([^,)]+)/i);
        if (sm1) {
          studentEnrollment = sm1[1];
          studentName = (sm1[2] || '').trim();
        } else if (sm2) {
          studentEnrollment = sm2[1];
          studentName = (sm2[2] || '').trim();
        } else if (sm3) {
          studentEnrollment = sm3[1];
        }

        // Items list:
        const im1 = details.match(/(?:from|of)\s+\[(.*?)\]/i);
        const im2 = details.match(/x\s+([A-Za-z0-9_-]+)\s+\(/i);
        const im3 = details.match(/,\s*([A-Za-z0-9_-]+)\s*x/i);
        if (im1) {
          itemsList = im1[1].split(/,\s*(?=[0-9]+\s*x|[A-Z])/i).map(p => parseComp(p));
        } else if (im2) {
          itemsList = [parseComp(im2[1])];
        } else if (im3) {
          itemsList = [parseComp(im3[1])];
        }
      }

      // Match issue record if available to enrich items with exact component quantities
      const seqMatch = (r.path || '').match(/\/issues\/(\d+)/) || details.match(/(?:issue\s+#|SCET-GP-[A-Z0-9_]+-)(\d+)/i);
      const seq = seqMatch ? parseInt(seqMatch[1], 10) : null;
      const issueObj = seq ? issuesBySeq.get(seq) : null;

      if (issueObj && Array.isArray(issueObj.items) && issueObj.items.length > 0) {
        if (itemsList.length === 0) {
          itemsList = issueObj.items.map(it => ({
            name: it.compName || it.compId,
            id: it.compId,
            qty: String(isIssued ? it.qty : (it.returnedQty || it.qty)),
            condition: it.returnCondition
          }));
        } else {
          itemsList.forEach(it => {
            const match = issueObj.items.find(x => x.compId === it.id);
            if (match) {
              const realQty = isIssued ? match.qty : (match.returnedQty || match.qty);
              if (!it.qty || it.qty === '1' || it.qty === 'null') {
                it.qty = String(realQty);
              }
              it.name = match.compName || it.name;
              if (match.conditions && Object.keys(match.conditions).length) {
                const cParts = Object.entries(match.conditions).filter(([_, c]) => c > 0).map(([k, c]) => `${c} ${k}`);
                if (cParts.length) it.condition = cParts.join(', ');
              } else if (match.returnCondition) {
                it.condition = `${it.qty} ${match.returnCondition}`;
              }
            }
          });
        }
        if (qty === '—' || qty === '1') {
          const sum = itemsList.reduce((acc, it) => acc + (parseInt(it.qty, 10) || 0), 0);
          if (sum > 0) qty = String(sum);
        }
      }

      // Student cell rendering: Name on top, enrollment below in mono
      let studentCell;
      if (studentEnrollment && studentName) {
        studentCell = h('div', { class: 'audit-student-cell', style: 'display:flex;flex-direction:column;gap:2px;min-width:130px' },
          h('span', { style: 'font-weight:700;color:var(--ink);font-size:0.9em;line-height:1.25' }, studentName),
          h('span', { class: 'muted', style: 'font-size:0.76em;font-family:monospace;letter-spacing:0.02em' }, studentEnrollment)
        );
      } else if (studentEnrollment) {
        studentCell = h('span', { style: 'font-family:monospace;font-weight:700;font-size:0.86em;color:var(--ink)' }, studentEnrollment);
      } else {
        studentCell = h('span', { class: 'muted' }, '—');
      }

      // Condition counts
      const numQty = parseInt(qty, 10) || 1;
      const conds = parseConditionCounts(details, numQty);

      // Render items with component name prominent, ID in small font, and condition badge
      let itemCell;
      if (itemsList.length === 0) {
        itemCell = h('span', { class: 'muted' }, '—');
      } else {
        itemCell = h('div', { class: 'audit-item-list', style: 'display:flex;flex-direction:column;gap:4px;min-width:140px;max-width:260px' },
          ...itemsList.map(it => {
            const itCond = it.condition;
            const isOk = itCond?.toLowerCase().includes('working');
            const isWarn = itCond?.toLowerCase().includes('damaged');
            const cls = isOk ? 'ok' : isWarn ? 'warn' : 'bad';
            return h('div', { class: 'audit-item-row', style: 'display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;line-height:1.3' },
              h('span', { style: 'font-weight:600;color:var(--ink);font-size:0.88em' }, it.name || it.id),
              it.name && it.id ? h('span', { class: 'muted', style: 'font-size:0.75em;font-family:monospace' }, `(${it.id})`) : null,
              it.qty ? h('span', { class: 'badge sm info', style: 'font-size:0.72em;padding:0 5px' }, `×${it.qty}`) : null,
              itCond ? h('span', { class: `badge sm ${cls}`, style: 'font-size:0.72em;padding:0 5px' }, itCond) : null
            );
          })
        );
      }

      // Action & Condition badges
      let actionCell;
      if (isIssued) {
        actionCell = h('span', { style: 'background:#22c55e;color:#fff;padding:3px 12px;border-radius:99px;font-size:0.82em;font-weight:700;display:inline-block' }, '⬆ Given');
      } else {
        actionCell = h('div', { style: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap' },
          h('span', { style: 'background:#f97316;color:#fff;padding:3px 10px;border-radius:99px;font-size:0.82em;font-weight:700' }, '⬇ Taken'),
          ...conds.map(c => {
            const cls = c.cond.toLowerCase() === 'working' ? 'ok' : c.cond.toLowerCase() === 'damaged' ? 'warn' : 'bad';
            return h('span', { class: `badge sm ${cls}`, style: 'font-size:0.76em;font-weight:700' }, `${c.count} ${c.cond}`);
          })
        );
      }

      // Replaces the cluttered "dustbin" DETAILS column with an elegant, clear view button & clean pill
      const parsedData = { isIssued, studentName, studentEnrollment, itemsList, qty, conds, details };

      const detailsCell = h('td', { style: 'white-space:nowrap' },
        h('button', {
          class: 'btn ghost sm audit-view-btn',
          style: 'display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:0.82em;padding:4px 12px;border:1.5px solid var(--line);border-radius:8px;background:#fff;color:var(--blue);cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.05);transition:all 0.2s ease',
          onclick: () => openAuditDetailModal(r, parsedData)
        }, '🔍 View Details')
      );

      return h('tr', { class: isIssued ? 'row-issued' : 'row-returned' },
        h('td', {}, badge(r.adminUsername, 'info')),
        h('td', { style: 'white-space:nowrap;font-size:0.85em' }, fmt(r.ts)),
        h('td', {}, studentCell),
        h('td', {}, itemCell),
        h('td', { style: 'text-align:center;font-weight:700;font-size:0.92em' }, qty),
        h('td', {}, actionCell),
        detailsCell
      );
    }));
  }

  let t;
  searchInput.oninput = () => { clearTimeout(t); t = setTimeout(load, 200); };
  filterSel.onchange = load;

  await load();

  wrap.replaceChildren(
    h('div', { class: 'row', style: 'gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap' },
      h('h3', { style: 'margin:0;flex:1' }, '📋 Issue / Return Register'),
      searchInput,
      filterSel,
    ),
    h('p', { class: 'muted small', style: 'margin-bottom:8px' },
      'Append-only register of all hardware issues and returns. Click "🔍 View Details" on any record to view its full transaction breakdown.'),
    h('div', { class: 'tbl-wrap' },
      h('table', {},
        h('thead', {},
          h('tr', {},
            ['Admin', 'Time', 'Student (Enrollment — Name)', 'Item', 'Qty', 'Action', 'Details']
              .map(x => h('th', {}, x))
          )
        ),
        tbody,
      )
    )
  );

  return { el: wrap };
}

export async function adminsTab() {
  const list = h('div');
  const load = async () => {
    const a = await api('/api/auth/admins');
    list.replaceChildren(table(['Admin ID', 'Name', 'Email', 'Status', ''], a.map((x) => h('tr', {},
      h('td', {}, x.username), h('td', {}, x.displayName), h('td', {}, x.email || h('span', { class: 'muted' }, '—')),
      h('td', {}, badge(x.isActive ? 'Active' : 'Deactivated', x.isActive ? 'ok' : 'bad')),
      h('td', {}, x.isActive && h('button', {
        class: 'btn danger sm', onclick: async () => {
          if (!confirm(`Deactivate ${x.username}?`)) return;
          try { await api(`/api/auth/admins/${x.username}/deactivate`, { method: 'POST' }); load(); } catch (e) { toast(e.message, 'err'); }
        }
      }, 'Deactivate'))))));
  };
  const add = () => {
    const f = fields([
      { name: 'username', label: 'New admin ID' },
      { name: 'displayName', label: 'Display name' },
      { name: 'email', label: 'Email (for password recovery)', type: 'email' },
      { name: 'password', label: 'Temporary password (min 8)', type: 'password' },
    ]);
    modal('Create admin account', f.el, [{ label: 'Create', cls: 'green', run: async (close) => { await api('/api/auth/admins', { method: 'POST', body: f.values() }); toast('Admin created.'); close(); load(); } }]);
  };
  await load();
  return {
    el: h('div', {},
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('p', { class: 'muted grow' }, '👥 Multiple admins supported — each signs in with their own ID & password. Only a signed-in admin can create another.'),
        h('button', { class: 'btn gold', onclick: add }, '+ New admin')), list)
  };
}
