<?php
/**
 * Front-end: where the card appears (auto-insert, shortcode, sidebar widget)
 * and the one deferred script that renders it. The markup printed here is an
 * empty placeholder with a reserved height, so the page never shifts (CLS) and
 * search engines index the article, not the widget.
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PBS_Frontend {

	/** Whether a placeholder was printed on this request. */
	private static $needed = false;

	public static function init() {
		add_shortcode( 'promptbama_studio', array( __CLASS__, 'shortcode' ) );
		add_filter( 'the_content', array( __CLASS__, 'auto_insert' ), 20 );
		add_action( 'wp_footer', array( __CLASS__, 'enqueue' ), 5 );
	}

	/** Should the card be auto-inserted into the current singular post? */
	private static function auto_insert_applies() {
		$o = PBS_Options::all();
		if ( ! PBS_Options::is_ready() || empty( $o['auto_insert'] ) ) {
			return false;
		}
		if ( ! is_singular() || ! in_the_loop() || ! is_main_query() ) {
			return false;
		}
		$post = get_post();
		if ( ! $post || ! in_array( $post->post_type, (array) $o['post_types'], true ) ) {
			return false;
		}
		$excluded = array_filter( array_map( 'absint', explode( ',', (string) $o['exclude_ids'] ) ) );
		if ( in_array( (int) $post->ID, $excluded, true ) ) {
			return false;
		}
		if ( ! empty( $o['include_cats'] ) ) {
			$cats = wp_get_post_categories( $post->ID );
			if ( ! array_intersect( array_map( 'intval', $cats ), array_map( 'intval', $o['include_cats'] ) ) ) {
				return false;
			}
		}
		/**
		 * Filter: allow themes/plugins to veto the automatic card on a post.
		 *
		 * @param bool    $show Whether to show.
		 * @param WP_Post $post Current post.
		 */
		return (bool) apply_filters( 'pbs_auto_insert', true, $post );
	}

	/** PromptBama category for a post, from the admin mapping. */
	public static function category_for_post( $post_id ) {
		$o   = PBS_Options::all();
		$map = (array) $o['category_map'];
		if ( $post_id ) {
			foreach ( wp_get_post_categories( $post_id ) as $term_id ) {
				if ( ! empty( $map[ $term_id ] ) ) {
					return $map[ $term_id ];
				}
			}
		}
		return (string) $o['default_category'];
	}

	/** Placeholder markup; the script mounts into it. */
	public static function placeholder( $args = array() ) {
		$args = wp_parse_args(
			$args,
			array(
				'layout'   => 'inline', // inline | sidebar
				'variant'  => '',       // '' = admin setting; a | b
				'category' => '',
			)
		);
		self::$needed = true;
		$category     = '' !== $args['category'] ? $args['category'] : self::category_for_post( get_the_ID() );
		$min_height   = 'sidebar' === $args['layout'] ? 330 : 400;

		return sprintf(
			'<div class="pbs-root" data-layout="%1$s" data-variant="%2$s" data-category="%3$s" style="min-height:%4$dpx;margin:28px 0;border-radius:24px;background:#000" data-nosnippet></div>',
			esc_attr( $args['layout'] ),
			esc_attr( in_array( $args['variant'], array( 'a', 'b' ), true ) ? $args['variant'] : '' ),
			esc_attr( sanitize_title( $category ) ),
			(int) $min_height
		);
	}

	/** [promptbama_studio variant="a|b" category="profile" layout="inline|sidebar"] */
	public static function shortcode( $atts ) {
		if ( ! PBS_Options::is_ready() ) {
			return '';
		}
		$atts = shortcode_atts(
			array(
				'variant'  => '',
				'category' => '',
				'layout'   => 'inline',
			),
			$atts,
			'promptbama_studio'
		);
		return self::placeholder(
			array(
				'variant'  => sanitize_key( $atts['variant'] ),
				'category' => sanitize_title( $atts['category'] ),
				'layout'   => 'sidebar' === $atts['layout'] ? 'sidebar' : 'inline',
			)
		);
	}

	/** Insert the card after the Nth paragraph of the post content. */
	public static function auto_insert( $content ) {
		if ( ! self::auto_insert_applies() || false !== strpos( $content, 'pbs-root' ) || has_shortcode( $content, 'promptbama_studio' ) ) {
			return $content;
		}
		$after = (int) PBS_Options::get( 'insert_after' );
		$card  = self::placeholder();
		if ( $after <= 0 ) {
			return $card . $content;
		}
		$parts = explode( '</p>', $content );
		if ( count( $parts ) <= $after ) {
			return $content . $card;
		}
		$out = '';
		foreach ( $parts as $i => $part ) {
			$out .= $part;
			if ( $i < count( $parts ) - 1 ) {
				$out .= '</p>';
			}
			if ( $i + 1 === $after ) {
				$out .= $card;
			}
		}
		return $out;
	}

	/** Load the widget only on pages that actually contain a card. */
	public static function enqueue() {
		if ( ! self::$needed ) {
			return;
		}
		$o = PBS_Options::all();

		wp_enqueue_script( 'pbs-widget', PBS_URL . 'assets/widget.js', array(), PBS_VERSION, true );
		if ( function_exists( 'wp_script_add_data' ) ) {
			wp_script_add_data( 'pbs-widget', 'strategy', 'defer' );
		}

		$captions = array_values( array_filter( array_map( 'trim', preg_split( '/\r\n|\n/', (string) $o['b_captions'] ) ) ) );

		wp_localize_script(
			'pbs-widget',
			'PBS_CONFIG',
			array(
				'version'     => PBS_VERSION,
				'cssUrl'      => PBS_URL . 'assets/widget.css?ver=' . PBS_VERSION,
				'apiBase'     => $o['api_base'],
				'siteKey'     => $o['site_key'],
				'trackUrl'    => esc_url_raw( rest_url( 'pbs/v1/track' ) ),
				'variant'     => $o['variant'],
				'abSplit'     => (int) $o['ab_split'],
				'accent'      => $o['accent'],
				'font'        => $o['font_family'],
				'showBrand'   => (bool) $o['show_brand'],
				'floatingBar' => (bool) $o['floating_bar'],
				'stylesLimit' => (int) $o['styles_limit'],
				'stylesTag'   => (string) $o['styles_tag'],
				'termsUrl'    => $o['terms_url'],
				'supportUrl'  => $o['support_url'],
				'texts'       => array(
					'a' => array(
						'eyebrow' => $o['a_eyebrow'],
						'title1'  => $o['a_title_1'],
						'title2'  => $o['a_title_2'],
						'sub'     => $o['a_sub'],
						'cta'     => $o['a_cta'],
					),
					'b' => array(
						'eyebrow'  => $o['b_eyebrow'],
						'title1'   => $o['b_title_1'],
						'title2'   => $o['b_title_2'],
						'sub'      => $o['b_sub'],
						'imagine'  => $o['b_imagine'],
						'more'     => $o['b_more'],
						'cta'      => $o['b_cta'],
						'captions' => $captions,
						'quote'    => $o['testimonial_text'],
						'quoteBy'  => $o['testimonial_name'],
					),
					'privacy'   => $o['privacy_text'],
					'guarantee' => $o['guarantee_text'],
					'social'    => (int) $o['social_count'] > 0 ? str_replace( '{n}', number_format_i18n( (int) $o['social_count'] ), $o['social_text'] ) : '',
					'floating' => $o['floating_text'],
				),
			)
		);
	}
}
