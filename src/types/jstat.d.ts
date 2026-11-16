// Minimal typings for the parts of jstat used by the analysis service.
// jstat is CommonJS: Node only exposes its module.exports as the default import.
declare module 'jstat' {
  const jStat: {
    centralF: { cdf(x: number, df1: number, df2: number): number };
    studentt: { inv(p: number, dof: number): number };
  };
  export default jStat;
}
