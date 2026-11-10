<?php
/**
 * Sidebar widget: a compact card for theme sidebars.
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PBS_Sidebar_Widget extends WP_Widget {

	public function __construct() {
		parent::__construct(
			'pbs_sidebar',
			__( 'پرامپت باما — استودیو عکس', 'promptbama-studio' ),
			array( 'description' => __( 'کارت جمع‌وجور ساخت پرتره با هوش مصنوعی', 'promptbama-studio' ) )
		);
	}

	public function widget( $args, $instance ) {
		if ( ! PBS_Options::is_ready() ) {
			return;
		}
		$variant  = isset( $instance['variant'] ) ? $instance['variant'] : '';
		$category = isset( $instance['category'] ) ? $instance['category'] : '';
		echo $args['before_widget']; // phpcs:ignore WordPress.Security.EscapeOutput
		echo PBS_Frontend::placeholder( // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside.
			array(
				'layout'   => 'sidebar',
				'variant'  => $variant,
				'category' => $category,
			)
		);
		echo $args['after_widget']; // phpcs:ignore WordPress.Security.EscapeOutput
	}

	public function form( $instance ) {
		$variant  = isset( $instance['variant'] ) ? $instance['variant'] : '';
		$category = isset( $instance['category'] ) ? $instance['category'] : '';
		?>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'variant' ) ); ?>"><?php esc_html_e( 'طرح', 'promptbama-studio' ); ?></label>
			<select class="widefat" id="<?php echo esc_attr( $this->get_field_id( 'variant' ) ); ?>" name="<?php echo esc_attr( $this->get_field_name( 'variant' ) ); ?>">
				<option value="" <?php selected( $variant, '' ); ?>><?php esc_html_e( 'طبق تنظیمات افزونه', 'promptbama-studio' ); ?></option>
				<option value="a" <?php selected( $variant, 'a' ); ?>><?php esc_html_e( 'طرح اول — سیاه و نئون', 'promptbama-studio' ); ?></option>
				<option value="b" <?php selected( $variant, 'b' ); ?>><?php esc_html_e( 'طرح دوم — احساسی', 'promptbama-studio' ); ?></option>
			</select>
		</p>
		<p>
			<label for="<?php echo esc_attr( $this->get_field_id( 'category' ) ); ?>"><?php esc_html_e( 'دسته‌ی پرامپت باما (اختیاری)', 'promptbama-studio' ); ?></label>
			<input class="widefat" type="text" id="<?php echo esc_attr( $this->get_field_id( 'category' ) ); ?>" name="<?php echo esc_attr( $this->get_field_name( 'category' ) ); ?>" value="<?php echo esc_attr( $category ); ?>" placeholder="profile" dir="ltr">
		</p>
		<?php
	}

	public function update( $new_instance, $old_instance ) {
		return array(
			'variant'  => in_array( $new_instance['variant'] ?? '', array( 'a', 'b' ), true ) ? $new_instance['variant'] : '',
			'category' => sanitize_title( $new_instance['category'] ?? '' ),
		);
	}
}
