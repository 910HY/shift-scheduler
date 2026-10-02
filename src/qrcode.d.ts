declare module "qrcode" {
  export function toString(
    text: string,
    options?: {
      type?: "svg" | "utf8" | "terminal";
      margin?: number;
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
      width?: number;
    },
  ): Promise<string>;
}
