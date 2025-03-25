import { BufferUtils } from '@src/core/crypto/utils/BufferUtils.js';
import { IM_MEDIA_EMBEDDED } from '@src/shared/lexicon/improto.lexicon.js';
import { IMProtoMessage } from '@src/shared/types/message.types.js';
import {
    base64Content,
    sha256,
    undefinedString,
} from '@src/shared/types/string.types.js';

/**
 * Represents the aspect ratio of media content
 */
export type AspectRatio = {
    width: number;
    height: number;
};

/**
 * Base interface for embedded media content
 * TODO: align with https://atproto.blue/en/latest/atproto/atproto_client.models.app.bsky.embed.images.html atproto_client.models.app.bsky.embed.images.ViewImage
 */
export interface EmbeddedBase64Media {
    // TODO: more restrictive typing
    mimeType: string;
    content: base64Content;
    alt?: string;
    aspectRatio?: AspectRatio;
}

/**
 * Media message for sending embedded media content
 *
 * Used to send media content (images, videos, audio) from a peer to another.
 * The content is embedded directly in the message as base64-encoded data.
 */
export interface IMMediaEmbeddedMessage extends IMProtoMessage {
    type: typeof IM_MEDIA_EMBEDDED;
    data: EmbeddedBase64Media;
}

/**
 * Implementation of media message handling
 * Provides factory methods for creating media messages from various sources
 */
export class IMMediaEmbedded implements IMMediaEmbeddedMessage {
    public type = IM_MEDIA_EMBEDDED as typeof IM_MEDIA_EMBEDDED;
    public data: EmbeddedBase64Media;
    public after: sha256 | undefinedString = '';

    constructor(data: EmbeddedBase64Media) {
        this.data = data;
    }

    /**
     * Creates a media message from a File or Blob
     * @param file File or Blob object containing the media content
     * @param alt Optional alt text for accessibility
     * @param aspectRatio Optional aspect ratio for proper display
     */
    static async fromFile(
        file: File | Blob,
        alt?: string,
        aspectRatio?: AspectRatio,
    ): Promise<IMMediaEmbedded> {
        const rawContent = new Uint8Array(await file.arrayBuffer());
        return new IMMediaEmbedded({
            mimeType: file.type,
            content: BufferUtils.mediaToBase64(rawContent),
            alt,
            aspectRatio,
        });
    }

    /**
     * Creates a media message from a base64-encoded string
     * @param base64 Base64-encoded content
     * @param mimeType MIME type of the content
     * @param alt Optional alt text for accessibility
     * @param aspectRatio Optional aspect ratio for proper display
     */
    static fromBase64(
        base64: string,
        mimeType: string,
        alt?: string,
        aspectRatio?: AspectRatio,
    ): IMMediaEmbedded {
        return new IMMediaEmbedded({
            mimeType,
            content: base64,
            alt,
            aspectRatio,
        });
    }

    /**
     * Creates a media message from raw binary content
     * @param rawContent Raw binary content as Uint8Array
     * @param mimeType MIME type of the content
     * @param alt Optional alt text for accessibility
     * @param aspectRatio Optional aspect ratio for proper display
     */
    static fromUint8Array(
        rawContent: Uint8Array,
        mimeType: string,
        alt?: string,
        aspectRatio?: AspectRatio,
    ): IMMediaEmbedded {
        return new IMMediaEmbedded({
            mimeType,
            content: BufferUtils.mediaToBase64(rawContent),
            alt,
            aspectRatio,
        });
    }
}
