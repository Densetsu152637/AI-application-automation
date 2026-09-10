export const MATCHING_CORPUS_VERSION = 'fictional-v1';
export type CorpusLabel = 'match' | 'reject' | 'needs_review';
export type CorpusVacancy = { id: string; title: string; arrangement: string | null; hours: string | null; label: CorpusLabel; identityKey: string };

const rows: CorpusVacancy[] = [];
for (let index = 1; index <= 60; index++) {
  const label: CorpusLabel = index <= 20 ? 'match' : index <= 40 ? 'reject' : 'needs_review';
  rows.push({
    id: `fictional-${String(index).padStart(3, '0')}`,
    title: label === 'match' ? `TypeScript internship ${index}` : label === 'reject' ? `Senior Java platform role ${index}` : `Software placement ${index}`,
    arrangement: label === 'reject' ? 'full-time' : label === 'needs_review' ? null : 'part-time',
    hours: label === 'needs_review' ? null : label === 'match' ? '20 hours/week' : '40 hours/week',
    label,
    identityKey: `fictional-job-${index}`,
  });
}

export const MATCHING_CORPUS = Object.freeze(rows);
