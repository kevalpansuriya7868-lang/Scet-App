const router = require('express').Router({ mergeParams: true });
const { db, FieldValue } = require('../firebase');
const { httpErr, clean } = require('../utils/http');
const { deleteWhere } = require('../utils/firestore');
const { audited } = require('../middleware/audit');

const IMG_RE = /^data:image\/(png|jpeg|webp);base64,/;
const key = (code, id) => `components/${code}__${id}`;

function parse(b) {
  const o = { name: clean(b.name), category: clean(b.category), specifications: clean(b.specifications), totalQty: Number(b.totalQty) };
  if (!o.name || !o.category) throw httpErr(400, 'Component name, category and total quantity are required.');
  if (!Number.isInteger(o.totalQty) || o.totalQty <= 0) throw httpErr(400, 'Total quantity must be a positive whole number.');
  return o;
}
function images(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > 5) throw httpErr(400, 'At most 5 images per component.');
  for (const s of list) if (typeof s !== 'string' || !IMG_RE.test(s) || s.length > 700000) throw httpErr(400, 'Images must be PNG/JPEG/WebP under ~500 KB each.');
  return list;
}
async function replaceImages(code, compId, list) {
  const col = db.collection('componentImages');
  await deleteWhere(col.where('branchCode', '==', code).where('compId', '==', compId));
  const batch = db.batch();
  list.forEach((data, order) => batch.set(col.doc(), { branchCode: code, compId, order, data }));
  batch.update(db.doc(key(code, compId)), { imageCount: list.length });
  await batch.commit();
}

// Auto-ID exactly like the desktop app: COMP-<first 3 letters>-<001..>
router.post('/', audited('COMPONENT_ADDED'), async (req, res) => {
  const code = req.branch;
  const o = parse(req.body);
  const imgs = images(req.body.images) || [];
  const letters = o.name.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = letters.length >= 3 ? letters.slice(0, 3) : letters.padEnd(3, 'X');
  let compId;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(db.collection('components').where('branchCode', '==', code).where('prefix', '==', prefix));
    let max = 0;
    s.forEach((d) => { const n = parseInt(d.data().compId.split('-').pop(), 10); if (n > max) max = n; });
    compId = `COMP-${prefix}-${String(max + 1).padStart(3, '0')}`;
    tx.create(db.doc(key(code, compId)), {
      compId, prefix, branchCode: code, ...o, issuedQty: 0, availableQty: o.totalQty, imageCount: 0, updatedAt: FieldValue.serverTimestamp(),
    });
  });
  if (imgs.length) await replaceImages(code, compId, imgs);
  res.locals.auditDetail = `Added ${compId} "${o.name}" (qty ${o.totalQty})`;
  res.status(201).json({ compId });
});

router.put('/:cid/images', audited('COMPONENT_IMAGES_UPDATED'), async (req, res) => {
  const code = req.branch, imgs = images(req.body.images) || [];
  await replaceImages(code, req.params.cid, imgs);
  res.locals.auditDetail = `Updated images for ${req.params.cid} (${imgs.length} images)`;
  res.json({ ok: true, count: imgs.length });
});

router.put('/:cid', audited('COMPONENT_EDITED'), async (req, res) => {
  const code = req.branch;
  // If only updating images:
  if (req.body.images !== undefined && !req.body.name && !req.body.category && !req.body.totalQty) {
    const imgs = images(req.body.images) || [];
    await replaceImages(code, req.params.cid, imgs);
    res.locals.auditDetail = `Updated images for ${req.params.cid} (${imgs.length} images)`;
    return res.json({ ok: true, count: imgs.length });
  }
  const o = parse(req.body), imgs = images(req.body.images);
  await db.runTransaction(async (tx) => {
    const ref = db.doc(key(code, req.params.cid));
    const s = await tx.get(ref);
    if (!s.exists) throw httpErr(404, 'Component not found.');
    const issued = s.data().issuedQty;
    if (o.totalQty < issued) throw httpErr(409, `Total quantity cannot be less than currently issued units (${issued}).`);
    tx.update(ref, { ...o, availableQty: o.totalQty - issued, updatedAt: FieldValue.serverTimestamp() });
  });
  if (imgs) await replaceImages(code, req.params.cid, imgs);
  res.locals.auditDetail = `Edited ${req.params.cid}: "${o.name}", total qty ${o.totalQty}${imgs ? ', images updated' : ''}`;
  res.json({ ok: true });
});

// Same cascade as the desktop app: images + issue history + component.
router.delete('/:cid', audited('COMPONENT_DELETED'), async (req, res) => {
  const code = req.branch, cid = req.params.cid;
  const ref = db.doc(key(code, cid));
  if (!(await ref.get()).exists) throw httpErr(404, 'Component not found.');
  await deleteWhere(db.collection('componentImages').where('branchCode', '==', code).where('compId', '==', cid));
  await deleteWhere(db.collection('issues').where('branchCode', '==', code).where('compId', '==', cid));
  await ref.delete();
  res.locals.auditDetail = `Deleted ${cid} with its images and issue history`;
  res.json({ ok: true });
});

module.exports = router;
