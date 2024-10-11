import { SmashDID } from '@src/types/did.types.js';

export interface SmashMessage {
    type: 'join' | 'discover' | 'text' | 'profile' | 'profiles' | 'action';
    data: any;
    after?: string;
}

export interface EncapsulatedSmashMessage extends SmashMessage {
    sha1: string;
    timestamp: string;
}
export interface JoinSmashMessage extends SmashMessage {
    type: 'join';
}

export interface ProfileSmashMessage extends SmashMessage {
    type: 'profile';
    data: SmashDID;
}

export interface ProfileListSmashMessage extends SmashMessage {
    type: 'profiles';
    data: SmashDID[];
}

export interface ActionSmashMessage extends SmashMessage {
    type: 'action';
    data: {
        target: SmashDID;
        action: 'smash' | 'pass' | 'clear' | 'block';
    };
}
export type Relationship = 'smash' | 'pass' | 'clear' | 'block';
