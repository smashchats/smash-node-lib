import { HashUtils } from '@src/core/crypto/utils/HashUtils.js';
import {
    EncapsulatedIMProtoMessage,
    IMProtoMessage,
} from '@src/shared/types/message.types.js';
import { ISO8601 } from '@src/shared/types/string.types.js';

export const encapsulateMessage = async (
    message: IMProtoMessage,
): Promise<EncapsulatedIMProtoMessage> => {
    const timestamp = new Date().toISOString() as ISO8601;
    const sha256 = await HashUtils.sha256fromObject({
        ...message,
        timestamp,
    });
    return { ...message, sha256, timestamp };
};
