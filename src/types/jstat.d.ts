// Minimal typings for the parts of jstat used by the analysis service.
declare module 'jstat' {
  export const jStat: {
    centralF: { cdf(x: number, df1: number, df2: number): number };
    studentt: { inv(p: number, dof: number): number };
  };
}
