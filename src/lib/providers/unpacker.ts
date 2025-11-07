/**
 * JavaScript Unpacker
 * 
 * This library provides functionality to detect and unpack JavaScript code
 * that has been packed using the popular 'p.a.c.k.e.r' obfuscation technique.
 */

interface Dictionary {
  [key: string]: number;
}

/**
 * JSPacker class for detecting and unpacking packed JavaScript code
 */
export class JSPacker {
  readonly packedJS: string;

  /**
   * Creates a JSPacker instance with the provided packed JavaScript code.
   * @param packedJS - The packed JavaScript code
   */
  constructor(packedJS: string) {
    this.packedJS = packedJS;
  }

  /**
   * Detects if the JavaScript code is packed using the p.a.c.k.e.r pattern.
   * @returns True if packed, false otherwise
   */
  detect(): boolean {
    const js = this.packedJS.replace(/ /g, '');
    const exp = /eval\(function\(p,a,c,k,e,(?:r|d)/;
    return exp.test(js);
  }

  /**
   * Unpacks the JavaScript code.
   * @returns The unpacked JavaScript or null if unpacking fails
   */
  unpack(): string | null {
    try {
      // Pattern to extract packed components
      const exp = /\}\s*\('(.*)',\s*(.*?),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s;
      const matches = exp.exec(this.packedJS);

      if (!matches || matches.length !== 5) {
        return null;
      }

      // Extract values from regex groups
      let payload = matches[1]!.replace(/\\'/g, "'");
      const radixStr = matches[2];
      const countStr = matches[3];
      const symArray = matches[4]!.split('|');

      // Parse radix and count
      const radix = parseInt(radixStr!, 10) || 36;
      const count = parseInt(countStr!, 10) || 0;

      // Verify symbol array length
      if (symArray.length !== count) {
        throw new Error('Unknown p.a.c.k.e.r. encoding');
      }

      // Create UnBase instance for decoding
      const unBase = new UnBase(radix);

      // Pattern to find encoded words
      const wordPattern = /\b\w+\b/g;
      
      // Replace encoded words with decoded values
      payload = payload.replace(wordPattern, (word: string): string => {
        // Decode the word to get index
        const index = unBase.unBase(word);
        
        // Get the corresponding value from symbol array
        if (index < symArray.length && symArray[index]) {
          return symArray[index];
        }
        
        return word;
      });

      return payload;
    } catch (error) {
      return null;
    }
  }
}

/**
 * UnBase class for decoding base-encoded strings
 */
export class UnBase {
  private readonly radix: number;
  private readonly alpha62: string = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private readonly alpha95: string = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
  private alphabet: string = '';
  private dictionary: Dictionary = {};

  /**
   * Creates an UnBase instance with the specified radix.
   * @param radix - The base for decoding operations
   */
  constructor(radix: number) {
    this.radix = radix;

    // Set up alphabet and dictionary for radix > 36
    if (radix > 36) {
      if (radix < 62) {
        this.alphabet = this.alpha62.substring(0, radix);
      } else if (radix > 62 && radix < 95) {
        this.alphabet = this.alpha95.substring(0, radix);
      } else if (radix === 62) {
        this.alphabet = this.alpha62;
      } else if (radix === 95) {
        this.alphabet = this.alpha95;
      }

      // Build dictionary for quick lookups
      for (let i = 0; i < this.alphabet.length; i++) {
        this.dictionary[this.alphabet.charAt(i)] = i;
      }
    }
  }

  /**
   * Converts an encoded string to its numeric value.
   * @param str - The encoded string
   * @returns The decoded numeric value
   */
  unBase(str: string): number {
    let ret = 0;

    if (this.alphabet === '') {
      // Use standard parseInt for radix <= 36
      ret = parseInt(str, this.radix);
    } else {
      // Custom decoding for radix > 36
      for (let i = 0; i < str.length; i++) {
        const char = str.charAt(str.length - 1 - i);
        const value = this.dictionary[char];
        if (value !== undefined) {
          ret += Math.pow(this.radix, i) * value;
        }
      }
    }

    return ret;
  }
}

/**
 * Helper function to unpack JavaScript code
 * @param packedCode - The packed JavaScript code
 * @returns The unpacked code or null if not packed
 */
export function unpackJavaScript(packedCode: string): string | null {
  const packer = new JSPacker(packedCode);
  if (packer.detect()) {
    return packer.unpack();
  }
  return null;
}

/**
 * Helper function for unpacking and returning original if unpacking fails
 * @param packedCode - The packed JavaScript code
 * @returns The unpacked code or original code
 */
export function unpackJsAndCombine(packedCode: string): string {
  const unpacked = unpackJavaScript(packedCode);
  return unpacked ?? packedCode;
}

// Type definitions for better TypeScript integration
export type UnpackResult = string | null;

export interface IPackerOptions {
  throwOnError?: boolean;
  preserveOriginal?: boolean;
}

/**
 * Extended unpacker with options
 */
export class JSPackerWithOptions extends JSPacker {
  private options: IPackerOptions;

  constructor(packedJS: string, options: IPackerOptions = {}) {
    super(packedJS);
    this.options = {
      throwOnError: false,
      preserveOriginal: true,
      ...options
    };
  }

  unpackWithOptions(): string {
    try {
      const result = this.unpack();
      
      if (result === null) {
        if (this.options.throwOnError) {
          throw new Error('Failed to unpack JavaScript');
        }
        return this.options.preserveOriginal ? this.packedJS : '';
      }
      
      return result;
    } catch (error) {
      if (this.options.throwOnError) {
        throw error;
      }
      return this.options.preserveOriginal ? this.packedJS : '';
    }
  }
}