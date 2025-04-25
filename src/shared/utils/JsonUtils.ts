import stringify from 'fast-json-stable-stringify';

/**
 * Utility class for JSON operations using fast-json-stable-stringify
 * This provides a more efficient and stable JSON stringification than the native JSON.stringify
 * which can help with stack overflow issues in environments like React Native
 */
export class JsonUtils {
    /**
     * Convert an object to a JSON string using fast-json-stable-stringify
     * @param obj The object to stringify
     * @returns JSON string representation of the object
     */
    public static stringify(obj: unknown): string {
        return stringify(obj);
    }

    /**
     * Parse a JSON string into an object
     * @param text The JSON string to parse
     * @returns Parsed object
     */
    public static parse<T>(text: string): T {
        return JSON.parse(text) as T;
    }

    /**
     * Create a deep copy of an object using JSON serialization
     * @param obj The object to deep copy
     * @param replacer Optional replacer function to transform values before copying
     * @returns A deep copy of the object
     */
    public static deepCopy<T>(obj: T): T {
        return JsonUtils.parse(JsonUtils.stringify(obj));
    }
}
