import { initializeApp } from "firebase/app"
import {
	Auth,
	User,
	browserLocalPersistence,
	getAuth,
	onAuthStateChanged,
	setPersistence,
	signInWithCustomToken,
	signOut,
} from "firebase/auth"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { firebaseConfig } from "./config"

export interface UserInfo {
	displayName: string | null
	email: string | null
	photoURL: string | null
}

export class FirebaseAuthManager {
	private providerRef: WeakRef<ClineProvider>
	private auth: Auth
	private disposables: vscode.Disposable[] = []

	constructor(provider: ClineProvider) {
		console.log("Initializing FirebaseAuthManager", { provider })
		this.providerRef = new WeakRef(provider)
		const app = initializeApp(firebaseConfig)
		this.auth = getAuth(app)
		console.log("Firebase app initialized", { appConfig: firebaseConfig })

		// Set persistence to LOCAL to maintain auth state across sessions
		setPersistence(this.auth, browserLocalPersistence)
			.then(() => {
				console.log("Firebase persistence set to LOCAL")
			})
			.catch((error) => {
				console.error("Error setting persistence:", error)
			})

		// Auth state listener
		onAuthStateChanged(this.auth, this.handleAuthStateChange.bind(this))
		console.log("Auth state change listener added")

		// Try to restore session
		this.restoreSession()
	}

	private async restoreSession() {
		console.log("Attempting to restore session")
		const provider = this.providerRef.deref()
		if (!provider) {
			console.log("Provider reference lost during session restore")
			return
		}

		// Check if we already have an active user session from Firebase's persistence
		const currentUser = this.auth.currentUser
		if (currentUser) {
			console.log("Found existing Firebase session")
			await provider.setUserInfo({
				displayName: currentUser.displayName,
				email: currentUser.email,
				photoURL: currentUser.photoURL,
			})
			console.log("Existing session restored")
			return
		}

		// If no active session, try to sign in with stored custom token
		const storedToken = await provider.getSecret("authToken")
		if (storedToken) {
			console.log("Found stored custom token, attempting to restore session")
			try {
				await this.signInWithCustomToken(storedToken)
				console.log("Session restored successfully with custom token")
			} catch (error) {
				console.error("Failed to restore session with custom token:", error)
				await provider.setAuthToken(undefined)
				await provider.setUserInfo(undefined)
				// Attempt to sign out to ensure clean state
				try {
					await this.signOut()
				} catch (signOutError) {
					console.error("Error during cleanup after failed session restore:", signOutError)
				}
			}
		} else {
			console.log("No stored custom token found")
		}
	}

	getCurrentUser(): User | null {
		return this.auth.currentUser
	}

	private async handleAuthStateChange(user: User | null) {
		console.log("Auth state changed", { user })
		const provider = this.providerRef.deref()
		if (!provider) {
			console.log("Provider reference lost")
			return
		}

		if (user) {
			console.log("User signed in", { userId: user.uid })
			// Store public user info in state
			await provider.setUserInfo({
				displayName: user.displayName,
				email: user.email,
				photoURL: user.photoURL,
			})
			console.log("User info set in provider", { user })
		} else {
			console.log("User signed out")
			await provider.setAuthToken(undefined)
			await provider.setUserInfo(undefined)
		}
		await provider.postStateToWebview()
		console.log("Webview state updated")
	}

	async signInWithCustomToken(token: string) {
		console.log("Signing in with custom token", { token })
		await signInWithCustomToken(this.auth, token)
	}

	async signOut() {
		console.log("Signing out")
		await signOut(this.auth)
	}

	dispose() {
		this.disposables.forEach((d) => d.dispose())
		console.log("Disposables disposed", { count: this.disposables.length })
	}
}
