// TODO: limit DLQs size and number
export class DLQ<K, V> extends Map<K, V[]> {
    push(key: K, ...values: V[]) {
        if (!this.has(key)) {
            this.set(key, []);
        }
        this.get(key)!.push(...values);
    }
}
