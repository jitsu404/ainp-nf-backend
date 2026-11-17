// Minimal typings for the parts of jstat used by the analysis service.
// jstat is CommonJS: Node only exposes its module.exports as the default import.
declare module 'jstat' {
  const jStat: {
    centralF: { cdf(x: number, df1: number, df2: number): number };
    studentt: { inv(p: number, dof: number): number };
    /** Studentized range: inv(probability, number of means, error df). */
    tukey: { inv(p: number, nmeans: number, dof: number): number };
    chisquare: { cdf(x: number, dof: number): number };
  };
  export default jStat;
}
