const dateFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** UNIX 秒 → 「2026.11.16」（日本時間） */
export function dateLabel(seconds: number): string {
  return dateFormatter.format(new Date(seconds * 1000)).replace(/\//g, '.');
}

/** UNIX 秒 → ISO 8601（<time datetime> 用） */
export function dateIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
