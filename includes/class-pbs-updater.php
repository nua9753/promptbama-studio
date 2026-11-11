<?php
/**
 * Self-update from GitHub.
 *
 * WordPress shows "update available" for this plugin whenever the Version in
 * promptbama-studio.php on the repository's main branch is newer than the
 * installed one, and installs it with the normal "Update now" button (or
 * automatically, if auto-updates are enabled for the plugin).
 *
 * Private repository: save a read-only fine-grained token (Contents: Read on
 * that one repository) in the plugin's Connection settings.
 *
 * @package PromptBamaStudio
 */

defined( 'ABSPATH' ) || exit;

class PBS_Updater {

	const CACHE = 'pbs_update_info';

	/** owner/repo on GitHub. Override with define( 'PBS_UPDATE_REPO', 'owner/repo' ). */
	public static function repo() {
		return defined( 'PBS_UPDATE_REPO' ) ? PBS_UPDATE_REPO : 'nua9753/promptbama-studio';
	}

	public static function branch() {
		return defined( 'PBS_UPDATE_BRANCH' ) ? PBS_UPDATE_BRANCH : 'main';
	}

	public static function init() {
		add_filter( 'pre_set_site_transient_update_plugins', array( __CLASS__, 'inject' ) );
		add_filter( 'plugins_api', array( __CLASS__, 'details' ), 10, 3 );
		add_filter( 'upgrader_source_selection', array( __CLASS__, 'fix_folder' ), 10, 4 );
		add_filter( 'http_request_args', array( __CLASS__, 'auth' ), 10, 2 );
		add_action( 'upgrader_process_complete', array( __CLASS__, 'flush' ), 10, 0 );
		// WordPress "Check again" (update-core.php?force-check=1) must also skip our cache.
		add_action( 'load-update-core.php', array( __CLASS__, 'maybe_force' ) );
		add_action( 'load-plugins.php', array( __CLASS__, 'maybe_force' ) );
		add_action( 'admin_post_pbs_check_update', array( __CLASS__, 'check_now' ) );
	}

	public static function maybe_force() {
		if ( ! empty( $_GET['force-check'] ) && current_user_can( 'update_plugins' ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			self::flush();
		}
	}

	/** Admin button: re-check GitHub now and refresh WordPress's update list. */
	public static function check_now() {
		if ( ! current_user_can( 'update_plugins' ) ) {
			wp_die( esc_html__( 'دسترسی ندارید.', 'promptbama-studio' ) );
		}
		check_admin_referer( 'pbs_check_update' );
		self::flush();
		self::remote( true );
		delete_site_transient( 'update_plugins' );
		wp_update_plugins();
		$back = wp_get_referer();
		wp_safe_redirect( $back && false !== strpos( $back, 'plugins.php' ) ? admin_url( 'plugins.php?pbs_checked=1' ) : admin_url( 'admin.php?page=promptbama-studio&tab=dashboard&pbs_checked=1' ) );
		exit;
	}

	private static function token() {
		$o = PBS_Options::all();
		return isset( $o['update_token'] ) ? (string) $o['update_token'] : '';
	}

	private static function api_base() {
		return 'https://api.github.com/repos/' . self::repo();
	}

	/** Latest version on GitHub (cached 6 hours; errors cached 1 hour). */
	public static function remote( $force = false ) {
		$cached = get_site_transient( self::CACHE );
		if ( ! $force && is_array( $cached ) ) {
			return $cached;
		}
		$info  = array( 'version' => '', 'error' => '', 'checked' => time() );
		$token = self::token();
		if ( '' === $token ) {
			// Public repository: raw file, no API rate limit.
			$res = wp_remote_get(
				'https://raw.githubusercontent.com/' . self::repo() . '/' . rawurlencode( self::branch() ) . '/promptbama-studio.php',
				array( 'timeout' => 15 )
			);
		} else {
			$res = wp_remote_get(
				self::api_base() . '/contents/promptbama-studio.php?ref=' . rawurlencode( self::branch() ),
				array(
					'timeout' => 15,
					'headers' => array( 'Accept' => 'application/vnd.github.raw' ),
				)
			);
		}
		if ( is_wp_error( $res ) ) {
			$info['error'] = $res->get_error_message();
		} elseif ( 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			$info['error'] = 'HTTP ' . wp_remote_retrieve_response_code( $res );
		} elseif ( preg_match( '/^[\s\*]*Version:\s*([0-9][0-9a-zA-Z.\-]*)/mi', wp_remote_retrieve_body( $res ), $m ) ) {
			$info['version'] = $m[1];
		} else {
			$info['error'] = 'version not found';
		}
		set_site_transient( self::CACHE, $info, '' === $info['error'] ? 3 * HOUR_IN_SECONDS : 30 * MINUTE_IN_SECONDS );
		return $info;
	}

	private static function package_url() {
		if ( '' === self::token() ) {
			return 'https://github.com/' . self::repo() . '/archive/refs/heads/' . rawurlencode( self::branch() ) . '.zip';
		}
		return self::api_base() . '/zipball/' . rawurlencode( self::branch() );
	}

	public static function inject( $transient ) {
		if ( ! is_object( $transient ) ) {
			return $transient;
		}
		$info = self::remote();
		$file = plugin_basename( PBS_FILE );
		if ( '' === $info['version'] ) {
			return $transient;
		}
		$item = (object) array(
			'id'          => self::repo(),
			'slug'        => dirname( $file ),
			'plugin'      => $file,
			'new_version' => $info['version'],
			'url'         => 'https://github.com/' . self::repo(),
			'package'     => self::package_url(),
			'tested'      => get_bloginfo( 'version' ),
		);
		if ( version_compare( $info['version'], PBS_VERSION, '>' ) ) {
			$transient->response[ $file ] = $item;
		} else {
			$transient->no_update[ $file ] = $item;
		}
		return $transient;
	}

	public static function details( $result, $action, $args ) {
		if ( 'plugin_information' !== $action || empty( $args->slug ) || dirname( plugin_basename( PBS_FILE ) ) !== $args->slug ) {
			return $result;
		}
		$info = self::remote();
		return (object) array(
			'name'          => 'PromptBama Studio',
			'slug'          => $args->slug,
			'version'       => $info['version'] ? $info['version'] : PBS_VERSION,
			'author'        => 'PromptBama',
			'homepage'      => 'https://github.com/' . self::repo(),
			'download_link' => self::package_url(),
			'sections'      => array(
				'description' => 'استودیو عکس هوش مصنوعی پرامپت باما برای سایت‌های همکار.',
				'changelog'   => 'تغییرات را در فایل readme.txt مخزن ببینید.',
			),
		);
	}

	/** GitHub zipballs unpack as "owner-repo-<sha>/"; install into our own folder name. */
	public static function fix_folder( $source, $remote_source, $upgrader, $hook_extra = array() ) {
		global $wp_filesystem;
		if ( empty( $hook_extra['plugin'] ) || plugin_basename( PBS_FILE ) !== $hook_extra['plugin'] ) {
			return $source;
		}
		$wanted = trailingslashit( $remote_source ) . dirname( plugin_basename( PBS_FILE ) ) . '/';
		if ( untrailingslashit( $source ) === untrailingslashit( $wanted ) ) {
			return $source;
		}
		if ( $wp_filesystem && $wp_filesystem->move( $source, $wanted, true ) ) {
			return $wanted;
		}
		return new WP_Error( 'pbs_update_folder', 'Could not prepare the PromptBama Studio update folder.' );
	}

	/** Send the token only to this repository's GitHub API URLs. */
	public static function auth( $args, $url ) {
		$token = self::token();
		if ( '' === $token || 0 !== strpos( $url, self::api_base() . '/' ) ) {
			return $args;
		}
		if ( ! isset( $args['headers'] ) || ! is_array( $args['headers'] ) ) {
			$args['headers'] = array();
		}
		$args['headers']['Authorization'] = 'Bearer ' . $token;
		if ( false !== strpos( $url, '/zipball/' ) ) {
			$args['headers']['Accept'] = 'application/vnd.github+json';
		}
		return $args;
	}

	public static function flush() {
		delete_site_transient( self::CACHE );
	}
}
