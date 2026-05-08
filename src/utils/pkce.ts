// src/external/bot-skeleton/utils/pkce.ts
export function generateCodeVerifier(): string {
    const array = crypto.getRandomValues(new Uint8Array(64));
    return Array.from(array)
        .map(v => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[v % 66])
        .join('');
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export function generateState(): string {
    const array = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}