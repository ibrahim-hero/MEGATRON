export function total(items, discountPercent = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.round((subtotal - discountPercent) * 100) / 100;
}
