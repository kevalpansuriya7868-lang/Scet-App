const { db } = require('../firebase');

/** Delete every doc matching a query, in batches (Firestore batch cap is 500). */
async function deleteWhere(query) {
  let total = 0;
  for (;;) {
    const snap = await query.limit(400).get();
    if (snap.empty) return total;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
}
module.exports = { deleteWhere };
