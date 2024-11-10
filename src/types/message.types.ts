import { SmashDID, SmashProfile } from '@src/types/did.types.js';

type sha256 = string;

export interface SmashMessage {
    type: 'join' | 'discover' | 'text' | 'profile' | 'profiles' | 'action';
    data: any;
    after?: sha256;
}

export interface EncapsulatedSmashMessage extends SmashMessage {
    sha256: sha256;
    timestamp: string;
}
export interface JoinSmashMessage extends SmashMessage {
    type: 'join';
}

export interface ProfileSmashMessage extends SmashMessage {
    type: 'profile';
    data: SmashProfile;
}

export interface ProfileListSmashMessage extends SmashMessage {
    type: 'profiles';
    data: SmashProfile[];
}

export type Relationship = 'smash' | 'pass' | 'clear' | 'block';

export interface ActionData {
    target: SmashDID;
    action: Relationship;
}

export interface ActionSmashMessage extends SmashMessage {
    type: 'action';
    data: ActionData;
}
