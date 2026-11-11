<?php
/**
 * Settings storage: one option array with defaults and per-field sanitising.
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PBS_Options {

	const KEY = 'pbs_settings';

	/** Default values (also the full list of known fields). */
	public static function defaults() {
		return array(
			// Connection.
			'api_base'          => 'https://promptbama.com',
			'site_key'          => '',
			'site_secret'       => '',
			'enabled'           => 0,

			// Design.
			'variant'           => 'ab',  // a | b | c | ab | abc
			'c_categories'      => '',
			'ab_split'          => 50,    // % of visitors who see design B
			'accent'            => '#D7FF3D',
			'font_family'       => 'inherit',
			'show_brand'        => 1,

			// Placement.
			'auto_insert'       => 1,
			'insert_after'      => 3,
			'post_types'        => array( 'post' ),
			'include_cats'      => array(),
			'exclude_ids'       => '',
			'floating_bar'      => 1,
			'styles_limit'      => 8,
			'styles_tag'        => '',

			// Category mapping: WP term id => PromptBama category slug.
			'category_map'      => array(),
			'default_category'  => '',

			// Texts — design A.
			'a_eyebrow'         => 'جدید · استودیو هوش مصنوعی',
			'a_title_1'         => 'این عکس‌ها،',
			'a_title_2'         => 'با چهره‌ی خودت.',
			'a_sub'             => 'یک سلفی بفرست و استایل را انتخاب کن؛ چند دقیقه بعد، پرتره‌ی حرفه‌ای خودت را تحویل بگیر.',
			'a_cta'             => 'با «%s» بساز',

			// Texts — design B (emotional).
			'b_eyebrow'         => 'مخصوص خواننده‌های ما',
			'b_title_1'         => 'عکسی که همیشه دلت می‌خواست،',
			'b_title_2'         => 'با چهره‌ی خودت.',
			'b_sub'             => 'نه عکاس لازم است، نه یک روز خاص. یک سلفی کافی است تا خودت را در این قاب‌ها ببینی.',
			'b_imagine'         => 'تصور کن امشب پروفایلت را عوض کنی و اولین پیام این باشد: «وای، کجا گرفتی؟»',
			'b_more'            => 'همه‌ی قاب‌ها را ببین',
			'b_cta'             => 'بله، این عکس را می‌خواهم',
			'b_captions'        => "برای پروفایلی که همه می‌پرسند کجا گرفتی\nعصر پاییزی‌ای که هیچ‌وقت عکسش را نگرفتی\nخودت، در قاب یک فیلم\nغروبی که فقط مال خودت است\nعکس تولدی شبیه رویاهایت\nهمان استایلی که در اینستاگرام دیدی\nبهاری که دلت برایش تنگ شده\nقابی که سال‌ها بعد هم دوستش داری",
			'testimonial_text'  => '',
			'testimonial_name'  => '',

			// Shared texts.
			'privacy_text'      => 'سلفی‌ات فقط مال خودت است؛ هیچ‌جا منتشر نمی‌شود و فقط در حساب خودت می‌ماند.',
			'floating_text'     => 'سلفی بده، عکس آتلیه‌ای بگیر',
			'terms_url'         => 'https://promptbama.com/terms',
			'support_url'       => '',
			'guarantee_text'    => 'تضمین کیفیت: راضی نبودی؟ در تلگرام پیام بده، رسیدگی می‌کنیم.',
			'social_count'      => 353,
			'social_text'       => '{n} نفر پرتره‌شان را با این استودیو ساخته‌اند',
			'update_token'      => '',
		);
	}

	/** All settings merged over defaults. */
	public static function all() {
		$saved = get_option( self::KEY, array() );
		return wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
	}

	public static function get( $key ) {
		$all = self::all();
		return isset( $all[ $key ] ) ? $all[ $key ] : null;
	}

	/** True when the plugin has credentials and is switched on. */
	public static function is_ready() {
		$o = self::all();
		return ! empty( $o['enabled'] ) && '' !== $o['site_key'] && '' !== $o['api_base'];
	}

	/**
	 * Sanitise a partial submission (one admin tab) and merge it into the
	 * stored settings. Unknown keys are dropped.
	 *
	 * @param array  $input Raw $_POST subset.
	 * @param string $tab   Tab that was submitted (controls checkbox semantics).
	 */
	public static function sanitize_tab( $input, $tab ) {
		$current = self::all();
		$input   = is_array( $input ) ? wp_unslash( $input ) : array();

		$checkboxes = array(
			'connection' => array( 'enabled' ),
			'design'     => array( 'show_brand' ),
			'placement'  => array( 'auto_insert', 'floating_bar' ),
		);
		foreach ( isset( $checkboxes[ $tab ] ) ? $checkboxes[ $tab ] : array() as $cb ) {
			$current[ $cb ] = empty( $input[ $cb ] ) ? 0 : 1;
		}

		$text_fields = array(
			'a_eyebrow', 'a_title_1', 'a_title_2', 'a_cta',
			'b_eyebrow', 'b_title_1', 'b_title_2', 'b_more', 'b_cta',
			'testimonial_name', 'floating_text', 'default_category', 'guarantee_text', 'social_text',
		);
		$area_fields = array( 'a_sub', 'b_sub', 'b_imagine', 'b_captions', 'testimonial_text', 'privacy_text' );

		foreach ( $input as $key => $value ) {
			if ( ! array_key_exists( $key, $current ) ) {
				continue;
			}
			switch ( $key ) {
				case 'api_base':
					$url = esc_url_raw( trim( (string) $value ), array( 'https', 'http' ) );
					$current[ $key ] = untrailingslashit( $url );
					break;
				case 'site_key':
					$current[ $key ] = preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $value );
					break;
				case 'site_secret':
					$v = preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) $value );
					if ( '' !== $v ) { // Empty field keeps the stored secret.
						$current[ $key ] = $v;
					}
					break;
				case 'variant':
					$current[ $key ] = in_array( $value, array( 'a', 'b', 'c', 'ab', 'abc' ), true ) ? $value : 'ab';
					break;
				case 'ab_split':
					$current[ $key ] = max( 0, min( 100, (int) $value ) );
					break;
				case 'accent':
					$c = sanitize_hex_color( (string) $value );
					$current[ $key ] = $c ? $c : '#D7FF3D';
					break;
				case 'font_family':
					$current[ $key ] = preg_replace( '/[^\p{L}\p{N} ,\'"\-_]/u', '', (string) $value );
					break;
				case 'insert_after':
					$current[ $key ] = max( 0, min( 30, (int) $value ) );
					break;
				case 'styles_limit':
					$current[ $key ] = max( 3, min( 20, (int) $value ) );
					break;
				case 'social_count':
					$current[ $key ] = max( 0, (int) $value );
					break;
				case 'update_token':
					$v = preg_replace( '/[^A-Za-z0-9_]/', '', (string) $value );
					if ( '' !== $v ) { // Empty field keeps the stored token.
						$current[ $key ] = $v;
					}
					break;
				case 'c_categories':
					$current[ $key ] = implode( ',', array_filter( array_map( 'sanitize_title', explode( ',', (string) $value ) ) ) );
					break;
				case 'styles_tag':
					$current[ $key ] = sanitize_title( (string) $value );
					break;
				case 'post_types':
					$current[ $key ] = array_values( array_filter( array_map( 'sanitize_key', (array) $value ) ) );
					break;
				case 'include_cats':
					$current[ $key ] = array_values( array_filter( array_map( 'absint', (array) $value ) ) );
					break;
				case 'exclude_ids':
					$ids = array_filter( array_map( 'absint', preg_split( '/[\s,]+/', (string) $value ) ) );
					$current[ $key ] = implode( ',', $ids );
					break;
				case 'category_map':
					$map = array();
					foreach ( (array) $value as $term_id => $slug ) {
						$slug = sanitize_title( (string) $slug );
						if ( '' !== $slug ) {
							$map[ absint( $term_id ) ] = $slug;
						}
					}
					$current[ $key ] = $map;
					break;
				case 'terms_url':
				case 'support_url':
					$current[ $key ] = esc_url_raw( trim( (string) $value ) );
					break;
				default:
					if ( in_array( $key, $text_fields, true ) ) {
						$current[ $key ] = sanitize_text_field( (string) $value );
					} elseif ( in_array( $key, $area_fields, true ) ) {
						$current[ $key ] = sanitize_textarea_field( (string) $value );
					}
			}
		}

		// The category mapping tab posts the whole map; an empty submission clears it.
		if ( 'mapping' === $tab && ! isset( $input['category_map'] ) ) {
			$current['category_map'] = array();
		}
		if ( 'placement' === $tab ) {
			if ( ! isset( $input['include_cats'] ) ) {
				$current['include_cats'] = array();
			}
			if ( ! isset( $input['post_types'] ) ) {
				$current['post_types'] = array();
			}
		}

		update_option( self::KEY, $current, false );
		return $current;
	}
}
