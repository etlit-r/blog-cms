/** タグ名を整える（サーバー側の cleanTagName と同じ規則） */
export const cleanTagName = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** 同じタグかどうかを判定するキー（サーバー側の tagKey と同じ規則） */
export const tagKey = (name: string) => cleanTagName(name).toLowerCase();
