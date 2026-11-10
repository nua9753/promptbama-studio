<?php
/**
 * Server-to-server client for the PromptBama partner API (admin only).
 * The site secret never leaves WordPress.
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PBS_API {

	/**
	 * GET a partner endpoint with the site key + secret.
	 *
	 * @param string $path  Path under /api/partner/v1 (e.g. "/site/ping").
	 * @param array  $query Query args.
	 * @return array|WP_Error Decoded JSON or error.
	 */
	public static function get( $path, $query = array() ) {
		$o = PBS_Options::all();
		if ( '' === $o['api_base'] || '' === $o['site_key'] || '' === $o['site_secret'] ) {
			return new WP_Error( 'pbs_missing_credentials', __( 'آدرس سرویس، کلید سایت و رمز سایت را وارد کنید.', 'promptbama-studio' ) );
		}
		$url = add_query_arg( $query, $o['api_base'] . '/api/partner/v1' . $path );
		$res = wp_remote_get(
			$url,
			array(
				'timeout' => 15,
				'headers' => array(
					'x-pb-site'     => $o['site_key'],
					'Authorization' => 'Bearer ' . $o['site_secret'],
					'Accept'        => 'application/json',
				),
			)
		);
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( $code >= 400 || ! is_array( $body ) ) {
			$msg = is_array( $body ) && ! empty( $body['error'] ) ? $body['error'] : 'HTTP ' . $code;
			return new WP_Error( 'pbs_http_' . $code, $msg );
		}
		return $body;
	}

	/** PromptBama categories, cached for an hour. */
	public static function categories( $force = false ) {
		$cached = get_transient( 'pbs_categories' );
		if ( ! $force && is_array( $cached ) ) {
			return $cached;
		}
		$res = self::get( '/categories' );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$cats = isset( $res['categories'] ) && is_array( $res['categories'] ) ? $res['categories'] : array();
		set_transient( 'pbs_categories', $cats, HOUR_IN_SECONDS );
		return $cats;
	}
}
